import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { Message, Conversation, User } from "../models/index.js";
import { getLogger } from '../utils/logger.js'

import msgService from "../service/msg.service.js";
import userService from "../service/user.service.js";
import { create } from "domain";

const logger = getLogger();

const onlineUsers = new Map(); // 保存用户 socketId

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
        onlineUsers.set(userId, socket.id);
        console.log(`✅ User connected: ${userId}`);

        // 通知所有客户端：用户上线
        // io.emit("user_online", { userId, online: true });

        onUserGetConversations(socket)
        onGetUnReadMessages(socket)
        onCreateConversation(socket);
        onUserSendMessage(socket);
        onUserGetLatestMsg(socket)
        onJoinConversation(socket)
        onLeaveConversation(socket)
        onGetMsgByTime(socket)
        // 断开连接
        onUserDisconnect(socket);

        // 返回用户的通信用户id, 以及他的所有会话
        let conversations = await msgService.getUserConversationList(userId)
        socket.emit("connect_res", { ok: true, data: { userId, conversations } });

        notiUserConnect(conversations, userId, true)
    });
}

const userOffline = async (userId) => {
    // 删除用户在线状态
    onlineUsers.delete(userId);
    // 准备通知
    // io.emit("user_offline", { userId, online: false });

    logger.info(`User offline: ${userId}`);

    // 通知下线
    let conversations = await msgService.getUserConversationList(userId)
    notiUserConnect(conversations, userId, false)

    // 保存用户最新的在线时间
    await User.updateOne({ _id: userId }, { lastSeen: Date.now() })
}

// 通知这些会话中除了上线者之外的在线用户, 该用户上线了
const notiUserConnect = async (conversations, userId, isConnect) => {
    let userIdLost = []
    for (let i = 0; i < conversations.length; i++) {
        let conversation = conversations[i];
        let { participants } = conversation
        for (let j = 0; j < participants.length; j++) {
            let participant = participants[j];
            if (participant._id.toString() !== userId.toString()) {
                let participantSocketId = onlineUsers.get(participant._id.toString());
                if (participantSocketId) {
                    userIdLost.push(participantSocketId)
                }
            }
        }
    }
    // 去重
    userIdLost = [...new Set(userIdLost)]
    userIdLost.forEach(item => io.to(item).emit("user_online", { userId, online: isConnect }))
}

// 用户断开连接事件
const onUserDisconnect = (socket) => {
    const userId = socket.user.id;
    socket.on("disconnect", () => {
        userOffline(userId)
    });
}

// 获取用户最新的消息
const onUserGetLatestMsg = (socket) => {
    const userId = socket.user.id;
    socket.on("get_latest_msg", async (data) => {
        let { conversationId, page, pageSize } = data
        try {
            let msgList = await msgService.getConversationMessages(conversationId, pageSize, page, userId)
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
// 传递用户消息
const emitConversationMessage = async (message, conversationId) => {
    // 更新会话最后消息
    let conversation = await Conversation.findById(conversationId);

    // 获取会话中所有用户ID, 发送给接收者（如果在线）
    const receiverIds = conversation.participants.filter(id => !message.senderId || id.toString() !== message.senderId._id.toString());
    if (receiverIds && receiverIds.length > 0) {
        receiverIds.forEach(receiverUserId => {
            let receiverSocketId = onlineUsers.get(receiverUserId.toString());
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("receive_message", { ok: true, data: { message, conversationId } })
                // 设置用户已读
                msgService.markMessageAsRead(message._id, receiverUserId)
            }
        })
    }
}
/**
 * 给用户发送会话被删除的事件
 * @param {*} conversationId 
 * @param {*} latestUserIds 
 */
const emitConversationDeletedMessage = async (conversationId, latestUserIds) => {
    latestUserIds.forEach(item => {
        let receiverSocketId = onlineUsers.get(item.toString());
        io.to(receiverSocketId).emit("conversation_deleted_res", conversationId)
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
            let receiverSocketId = onlineUsers.get(receiverUserId.toString());
            if (receiverSocketId) {
                io.to(receiverSocketId).emit(eventName, data)
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
            const { conversationId, content } = data;

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
            const message = await msgService.sendMessageToConversation(conversationId, userId, { content })

            // 处理消息通信
            await emitConversationMessage(message, conversationId)

            // 同步给发送者（更新自己界面）
            socket.emit("message_sent", { ok: true, data: { message, conversationId } });
        } catch (err) {
            console.error("❌ send_message error:", err);
        }
    });
}

/**
 * 获取会话列表
 * @param {*} socket 
 */
const onUserGetConversations = (socket) => {
    const userId = socket.user.id;
    // 监听获取会话列表事件
    socket.on("get_conversations", async () => {
        let cList = await msgService.getUserConversationList(userId);
        // 整理消息数据
        cList = cList.map(item => {
            let { _id, name, type, createdAt, lastMessageAt, lastMessage, participants } = item
            return { _id, name, type, createdAt, lastMessageAt, lastMessage, participants }
        })
        // 设定用户登录状态
        cList.forEach(c => {
            let users = c.participants.filter(item => item.toString() !== userId.toString())
            users.forEach(u => {
                u.online = onlineUsers.has(u._id.toString())
            })
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
    socket.on("get_msg_by_time", async (data) => {
        let { conversationId, time } = data
        let queryTime = new Date(time)
        try {
            let msgList = await msgService.getMsgByTime(conversationId, userId, queryTime);
            socket.emit("get_msg_by_time_res", { ok: true, data: { messages: msgList, conversationId } });
        } catch (error) {
            socket.emit("get_msg_by_time_res", { ok: false, msg: 'chat.error.get_msg_list' });
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
    let sId = onlineUsers.get(userId)
    onlineUsers.delete(userId)
    // 中断链接
    io.to(sId).disconnectSockets()
}



// ================= test ===================
// import connectDB from "../config/db.js";
// import dotenv from "dotenv";
// const test = async () => {

//     dotenv.config();
//     connectDB()
// }
// await test()