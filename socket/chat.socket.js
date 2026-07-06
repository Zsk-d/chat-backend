import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { Message, Conversation, User } from "../models/index.js";
import { getLogger } from '../utils/logger.js'

import msgService from "../service/msg.service.js";
import userService from "../service/user.service.js";
import { create } from "domain";

const logger = getLogger();

const onlineUsers = new Map(); // userId -> Set<socketId>，支持多连接
const adminUsers = new Map();

// 每个用户允许的最大 WebSocket 连接数，可通过环境变量配置
const MAX_CONNECTIONS_PER_USER = parseInt(process.env.MAX_CONNECTIONS_PER_USER) || 3;

// 初始化Socket.io
let io = null

const initIo = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",  // ✅ 临时允许所有来源（开发模式）
            methods: ["GET", "POST"],
            credentials: true
        }
    });
    logger.info('🚀 Socket.io server started');
}
/**
 * 连接认证初始化
 */
const initConnectAuth = () => {
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("No token"));
        try {
            const user = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = user;
            socket.user.isAdmin = !!user.isAdmin;

            // 检查用户是否已达到最大连接数
            const userSockets = onlineUsers.get(user.id);
            if (!socket.user.isAdmin && userSockets && userSockets.size >= MAX_CONNECTIONS_PER_USER) {
                return next(new Error("Maximum connection limit reached"));
            }
            next();
        } catch (err) {
            next(new Error("Invalid token"));
        }
    });
}

// 链接事件初始化
const initConnection = () => {
    io.on("connection", async (socket) => {
        const userId = socket.user.id;
        const isAdmin = !!socket.user.isAdmin;
        const userMap = isAdmin ? adminUsers : onlineUsers;

        // 添加 socket 到用户的连接集合
        if (!userMap.has(userId)) {
            userMap.set(userId, new Set());
        }
        const isFirstConnection = userMap.get(userId).size === 0;
        userMap.get(userId).add(socket.id);

        console.log(`✅ User connected: ${userId} (socket: ${socket.id}, connections: ${userMap.get(userId).size}, isAdmin: ${isAdmin})`);

        // 注册业务事件（每个 socket 都需要注册）
        onUserGetConversations(socket)
        onGetUnReadMessages(socket)
        onCreateConversation(socket);
        onUserSendMessage(socket);
        onUserGetLatestMsg(socket)
        onJoinConversation(socket)
        onLeaveConversation(socket)
        onGetMsgByTime(socket)
        onConversationMsgRead(socket)
        // 断开连接
        onUserDisconnect(socket);

        // 返回用户的通信用户id, 以及他的所有会话
        let conversations = isAdmin ? await msgService.getVirConversationList() : await msgService.getUserConversationList(userId)
        socket.emit("connect_res", { ok: true, data: { userId, isAdmin, conversations } });

        // 仅首次连接时通知其他用户上线
        if (isFirstConnection && !isAdmin) {
            notiUserConnect(conversations, userId, true)
        }
    });
}

const userOffline = async (socketId, userId, isAdmin = false) => {
    // 从用户的连接集合中移除该 socket
    const userSockets = isAdmin ? adminUsers.get(userId) : onlineUsers.get(userId);
    if (userSockets) {
        userSockets.delete(socketId);
        // 如果该用户还有剩余连接，不触发离线逻辑
        if (userSockets.size > 0) {
            logger.info(`User ${userId} disconnected one socket, ${userSockets.size} remaining`);
            return;
        }
        // 所有连接都已断开，清理用户在线状态
        if (isAdmin) {
            adminUsers.delete(userId);
        } else {
            onlineUsers.delete(userId);
        }
    }

    logger.info(`User offline: ${userId}`);

    // 通知下线
    let conversations = await msgService.getUserConversationList(userId)
    notiUserConnect(conversations, userId, false)

    // 保存用户最新的在线时间
    await User.updateOne({ _id: userId }, { lastSeen: Date.now() })
}

// 通知这些会话中除了上线者之外的在线用户, 该用户上线了
const notiUserConnect = async (conversations, userId, isConnect) => {
    let targetSocketIds = new Set()
    for (let i = 0; i < conversations.length; i++) {
        let conversation = conversations[i];
        let { participants } = conversation
        for (let j = 0; j < participants.length; j++) {
            let participant = participants[j];
            if (participant._id.toString() !== userId.toString()) {
                let participantSockets = onlineUsers.get(participant._id.toString());
                if (participantSockets) {
                    participantSockets.forEach(sid => targetSocketIds.add(sid))
                }
            }
        }
    }
    targetSocketIds.forEach(sid => io.to(sid).emit("user_online", { userId, online: isConnect }))
}

// 用户断开连接事件
const onUserDisconnect = (socket) => {
    const userId = socket.user.id;
    const isAdmin = !!socket.user.isAdmin;
    socket.on("disconnect", () => {
        userOffline(socket.id, userId, isAdmin)
    });
}

// 获取用户最新的消息
const onUserGetLatestMsg = (socket) => {
    const userId = socket.user.id;
    const allowAdmin = !!socket.user.isAdmin;
    socket.on("get_latest_msg", async (data) => {
        let { conversationId, page, pageSize } = data
        try {
            let msgList = await msgService.getConversationMessages(conversationId, pageSize, page, userId, allowAdmin)
            socket.emit("get_latest_msg_res", { ok: true, data: msgList });
        } catch (error) {
            socket.emit("get_latest_msg_res", { ok: false, msg: 'chat.error.get_latest_msg' });
        }
    });
}

// 用户加入会话
const onJoinConversation = (socket) => {
    const userId = socket.user.id;
    socket.on("join_conversation", async (data) => {
        let { conversationId } = data
        // 获取会话中其他用户ID
        try {
            let { participants } = await msgService.joinConversation(conversationId, userId)
            // 通知群成员
            await emitUserConversationEvent('join_conversation_res', conversationId, { ok: true, data: { conversationId, participants } })

        } catch (error) {
            socket.emit("join_conversation_res", { ok: false, msg: error.message });
        }
    })
}

// 用户离开会话
const onLeaveConversation = (socket) => {
    const userId = socket.user.id;
    socket.on("leave_conversation", async (data) => {
        let { conversationId } = data
        // 获取会话中其他用户ID
        try {
            let { conversationDeleted, latestUserIds } = await msgService.leaveConversation(conversationId, userId)
            if (conversationDeleted) {
                // 通知群成员 会话解散
                await emitConversationDeletedMessage(conversationId, latestUserIds)
            } else {
                let data = { ok: true, data: { conversationId, userId } }
                // 通知群成员 有人离开会话
                await emitUserConversationEvent('leave_conversation_res', conversationId, data)
                // 告诉他自己
                socket.emit("leave_conversation_res", { ok: true, data });
            }
        } catch (error) {
            socket.emit("leave_conversation_res", { ok: false, msg: error.message });
        }
    })
}
const emitAdminConversationMessage = async (message, conversationId) => {
    const adminSocketIds = new Set()
    adminUsers.forEach(socketIds => {
        socketIds.forEach(socketId => adminSocketIds.add(socketId))
    })

    adminSocketIds.forEach(socketId => {
        io.to(socketId).emit("admin_receive_message", { ok: true, data: { message, conversationId } })
    })
}

// 传递用户消息
const emitConversationMessage = async (message, conversationId) => {
    // 更新会话最后消息
    let conversation = await Conversation.findById(conversationId);

    // 获取会话中所有用户ID, 发送给接收者（如果在线）
    const receiverIds = conversation.participants.filter(id => !message.senderId || id.toString() !== message.senderId._id.toString());
    if (receiverIds && receiverIds.length > 0) {
        receiverIds.forEach(receiverUserId => {
            let receiverSockets = onlineUsers.get(receiverUserId.toString());
            if (receiverSockets) {
                receiverSockets.forEach(socketId => {
                    io.to(socketId).emit("receive_message", { ok: true, data: { message, conversationId } })
                })
                // 设置用户已读
                msgService.markMessageAsRead(message._id, receiverUserId)
            }
        })
    }

    // 只要是包含虚拟用户的会话，管理端也同步收到一份消息
    const virUsers = await User.exists({ _id: { $in: conversation.participants }, vir: true })
    if (virUsers) {
        await emitAdminConversationMessage(message, conversationId)
    }
}
/**
 * 给用户发送会话被删除的事件
 * @param {*} conversationId 
 * @param {*} latestUserIds 
 */
const emitConversationDeletedMessage = async (conversationId, latestUserIds) => {
    latestUserIds.forEach(item => {
        let receiverSockets = onlineUsers.get(item.toString());
        if (receiverSockets) {
            receiverSockets.forEach(socketId => {
                io.to(socketId).emit("conversation_deleted_res", conversationId)
            })
        }
    })
}
/**
 * 向会话中所有在线用户发送事件
 * @param {*} eventName 
 * @param {*} conversationId 
 * @param {*} data 
 * @param {*} exclude 排除用户
 */
const emitUserConversationEvent = async (eventName, conversationId, data, exclude) => {
    let conversation = await Conversation.findById(conversationId);

    // 获取会话中所有用户ID, 发送给接收者（如果在线）
    const receiverIds = conversation.participants.filter(id => !exclude || id.toString() !== exclude);
    if (receiverIds && receiverIds.length > 0) {
        receiverIds.forEach(receiverUserId => {
            let receiverSockets = onlineUsers.get(receiverUserId.toString());
            if (receiverSockets) {
                receiverSockets.forEach(socketId => {
                    io.to(socketId).emit(eventName, data)
                })
            }
        })
    }
}
// 创建会话
const onCreateConversation = (socket) => {
    const userId = socket.user.id;

    socket.on("create_conversation", async (data) => {
        let { receiverIds } = data
        const conversation = await msgService.createConversation(userId, receiverIds)
        if (conversation) {
            let { _id, name, type } = conversation
            await emitUserConversationEvent('create_conversation_res', _id, { ok: true, data: { _id, name, type } })
        } else {
            socket.emit("create_conversation_res", { ok: false, msg: "chat.error.create_conversation" });
        }
    });
}
// 用户发送消息事件监听
const onUserSendMessage = (socket) => {
    const userId = socket.user.id;

    // 📩 监听发送消息事件
    socket.on("send_message", async (data) => {
        try {
            const { conversationId, content, type } = data;

            // 开始区分新会话和旧会话
            let conversation = null
            if (conversationId) {
                // 先检查是否有会话
                conversation = await Conversation.findById(conversationId)
                if (!conversation) {
                    socket.emit("send_message_res", { ok: false, msg: "chat.error.no_conversation" });
                    return;
                }
            } else {
                socket.emit("send_message_res", { ok: false, msg: "chat.error.no_conversation_id" });
                return;
            }
            // 保存消息到数据库
            const message = await msgService.sendMessageToConversation(conversationId, userId, { content, type })

            // 处理消息通信
            await emitConversationMessage(message, conversationId)

            // 同步给发送者的所有连接（更新自己界面）
            let senderSockets = onlineUsers.get(userId);
            if (senderSockets) {
                senderSockets.forEach(sid => {
                    io.to(sid).emit("message_sent", { ok: true, data: { message, conversationId } });
                })
            }
        } catch (err) {
            console.error("❌ send_message error:", err);
        }
    });

    // 管理员以虚拟用户身份发送消息
    socket.on("admin_send_message", async (data) => {
        try {
            const { conversationId, content, type, senderId } = data;
            if (!socket.user.isAdmin) {
                socket.emit("admin_send_message_res", { ok: false, msg: "chat.error.no_permission" });
                return;
            }
            if (!conversationId) {
                socket.emit("admin_send_message_res", { ok: false, msg: "chat.error.no_conversation_id" });
                return;
            }
            if (!senderId) {
                socket.emit("admin_send_message_res", { ok: false, msg: "chat.error.no_sender" });
                return;
            }

            const senderUser = await User.findById(senderId);
            if (!senderUser || !senderUser.vir) {
                socket.emit("admin_send_message_res", { ok: false, msg: "chat.error.no_permission" });
                return;
            }

            const conversation = await Conversation.findById(conversationId)
            if (!conversation) {
                socket.emit("admin_send_message_res", { ok: false, msg: "chat.error.no_conversation" });
                return;
            }

            const message = await msgService.sendMessageToConversation(conversationId, senderId, { content, type })
            await emitConversationMessage(message, conversationId)

            socket.emit("admin_send_message_res", { ok: true, data: { message, conversationId } })
        } catch (err) {
            socket.emit("admin_send_message_res", { ok: false, msg: err.message || "chat.error.send_message" });
        }
    });
}

/**
 * 获取会话列表
 * @param {*} socket 
 */
const onUserGetConversations = (socket) => {
    const userId = socket.user.id;
    const isAdmin = !!socket.user.isAdmin;
    // 监听获取会话列表事件
    socket.on("get_conversations", async () => {
        let cList = isAdmin ? await msgService.getVirConversationList() : await msgService.getUserConversationList(userId);
        // 整理消息数据
        cList = cList.map(item => {
            let { _id, name, type, createdAt, lastMessageAt, lastMessage, participants, unreadCount, hasUnread, virUsers, customerUsers } = item
            return { _id, name, type, createdAt, lastMessageAt, lastMessage, participants, unreadCount, hasUnread, virUsers, customerUsers }
        })
        // 设定用户登录状态
        cList.forEach(c => {
            if (Array.isArray(c.participants)) {
                c.participants.forEach((u) => {
                    if (u && u._id) {
                        u.online = onlineUsers.has(u._id.toString())
                    }
                })
            }
        })
        socket.emit("get_conversations_res", cList);
    });
}

const onGetUnReadMessages = async (socket) => {
    const userId = socket.user.id;
    // 监听获取历史消息列表事件
    socket.on("get_unread_msg_list", async (data) => {
        let { conversationId } = data
        try {

            let msgList = await msgService.getUnReadMessages(conversationId, userId);
            socket.emit("get_unread_msg_list_res", { ok: true, data: msgList });
        } catch (error) {
            socket.emit("get_unread_msg_list_res", { ok: false, msg: 'chat.error.get_unread_msg_list' });
        }
    });
}

const onGetMsgByTime = async (socket) => {
    const userId = socket.user.id;
    const allowAdmin = !!socket.user.isAdmin;
    socket.on("get_msg_by_time", async (data) => {
        let { conversationId, time } = data
        let queryTime = new Date(time)
        try {
            let msgList = await msgService.getMsgByTime(conversationId, userId, queryTime, 20, allowAdmin);
            socket.emit("get_msg_by_time_res", { ok: true, data: { messages: msgList, conversationId } });
        } catch (error) {
            socket.emit("get_msg_by_time_res", { ok: false, msg: 'chat.error.getMsgListError' });
        }
    });
}

const onConversationMsgRead = async (socket) => {
    const userId = socket.user.id;
    const allowAdmin = !!socket.user.isAdmin;

    socket.on("conversation_msg_read", async (data) => {
        let { conversationId } = data

        try {
            if (allowAdmin) {
                return;
            }
            let msgList = await msgService.markConMsgReadByConIdAndUid(conversationId, userId);
            // 通知该频道下的其他人, 某人已经读取了所有消息
            emitUserConversationEvent('conversation_msg_read_res', conversationId, { ok: true, data: { conversationId, uid: userId } }, userId)
            // socket.emit("get_msg_by_time_res", { ok: true, data: { messages: msgList, conversationId } });
        } catch (error) {
            // socket.emit("get_msg_by_time_res", { ok: false, msg: 'chat.error.getMsgListError' });
        }
    });
}



export const initSocket = (server) => {
    initIo(server)
    initConnectAuth()
    initConnection()
};

export const getOnlineUserIds = () => Array.from(onlineUsers.keys());

export const getOnlineNum = () => onlineUsers.size;

export const closeUser = (userId) => {
    let userSockets = onlineUsers.get(userId)
    if (userSockets) {
        userSockets.forEach(socketId => {
            io.to(socketId).disconnectSockets()
        })
        onlineUsers.delete(userId)
    }
}



// ================= test ===================
// import connectDB from "../config/db.js";
// import dotenv from "dotenv";
// const test = async () => {

//     dotenv.config();
//     connectDB()
// }
// await test()


