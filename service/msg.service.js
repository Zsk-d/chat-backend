import { Message, Conversation, User } from "../models/index.js";

/**
 * 通过用户ID获取参与的会话列表
 * @param {string} userId - 用户ID
 * @returns {Promise<Array>} 会话列表
 */
const getUserConversationList = async (userId) => {
    let res = await Conversation.find({ participants: { $in: [userId] } })
        .populate('participants', 'username uid vir online')
        .populate({
            path: 'lastMessage',
            populate: {
                path: 'senderId',
                select: 'username'
            }
        });

    // 设定有没有未读消息
    // 查询会话中是否有未读的消息
    // 数量
    const conversationsWithUnread = await Promise.all(res.map(async (conversation) => {
        const conversationId = conversation._id;

        const unreadCount = await Message.countDocuments({
            conversationId: conversationId,
            readByUserIds: { $ne: userId }
        });

        const hasUnread = await Message.exists({
            conversationId: conversationId,
            readByUserIds: { $ne: userId }
        });

        // 转换为普通对象并添加未读信息
        const conversationObj = sanitizeConversation(conversation, false);
        conversationObj.hasUnread = !!hasUnread;
        conversationObj.unreadCount = unreadCount;

        return conversationObj;
    }));

    return conversationsWithUnread;
};

/**
 * 获取所有包含虚拟用户的会话。
 * 管理端会基于这个列表展示“虚拟用户聊天”页面。
 * 支持分页，默认按最近消息时间倒序。
 */
const getVirConversationList = async (page = 1, limit = 20) => {
    const virUsers = await User.find({ vir: true }).select('_id');
    const virIds = virUsers.map(item => item._id);
    if (!virIds.length) {
        return {
            rows: [],
            pagination: {
                currentPage: page,
                pageSize: limit,
                total: 0,
                totalPages: 0,
                hasNextPage: false,
                hasPrevPage: page > 1
            }
        };
    }

    const query = { participants: { $in: virIds } };
    const total = await Conversation.countDocuments(query);
    const skip = (page - 1) * limit;

    const conversations = await Conversation.find(query)
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('participants', 'username uid vir online')
        .populate({
            path: 'lastMessage',
            populate: {
                path: 'senderId',
                select: 'username uid vir'
            }
        });

    const rows = conversations.map(conversation => {
        const conversationObj = sanitizeConversation(conversation, true);
        conversationObj.virUsers = (conversationObj.participants || []).filter(item => item.vir);
        conversationObj.customerUsers = (conversationObj.participants || []).filter(item => !item.vir);
        return conversationObj;
    });

    // 管理端的未读状态，默认按会话里第一个虚拟用户来判断。
    // 这样连接完成后，列表就能直接展示离线期间的新消息红点。
    await Promise.all(rows.map(async (conversationObj) => {
        const virUser = conversationObj.virUsers?.[0];
        if (!virUser?._id) {
            conversationObj.hasUnread = false;
            conversationObj.unreadCount = 0;
            return;
        }

        const unreadCount = await Message.countDocuments({
            conversationId: conversationObj._id,
            readByUserIds: { $ne: virUser._id },
            deleted: false
        });
        conversationObj.hasUnread = unreadCount > 0;
        conversationObj.unreadCount = unreadCount;
    }));

    return {
        rows,
        pagination: {
            currentPage: page,
            pageSize: limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page < Math.ceil(total / limit),
            hasPrevPage: page > 1
        }
    };
};

/**
 * 用户创建一个新的会话
 * @param {string} creatorId - 创建者ID
 * @param {Array<string>} participantIds - 参与者ID列表
 * @param {string} [name] - 会话名称（可选）
 * @returns {Promise<object>} 新创建的会话
 */
const createConversation = async (creatorId, participantIds, name) => {
    // 确保创建者在参与者列表中
    if (!participantIds.includes(creatorId)) {
        participantIds.push(creatorId);
    }

    // 确保参与者不重复
    const uniqueParticipants = [...new Set(participantIds)];

    // 设置默认会话名（如果未提供且是私聊，则使用参与者用户名）
    let conversationName = name;
    let type = "private";

    if (uniqueParticipants.length > 2) {
        type = "group";
    } else if (!name && uniqueParticipants.length === 2) {
        // 对于私聊，获取对方用户名作为会话名
        const otherParticipant = uniqueParticipants.find(id => id.toString() !== creatorId.toString());
        if (otherParticipant) {
            const user = await User.findById(otherParticipant);
            if (user) {
                conversationName = user.username;
            }
        }
    }

    const conversation = new Conversation({
        name: conversationName,
        type,
        participants: uniqueParticipants
    });

    return await conversation.save();
};

/**
 * 用户向会话中发送消息
 * @param {string} conversationId - 会话ID
 * @param {string} senderId - 发送者ID
 * @param {object} messageData - 消息数据
 * @returns {Promise<object>} 新创建的消息
 */
const sendMessageToConversation = async (conversationId, senderId, messageData) => {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new Error('chat.error.no_conversation');
    }
    if (senderId) {
        // 非系统用户, 验证发送者是否在会话中
        const isParticipant = conversation.participants.some(
            participant => participant.toString() === senderId.toString()
        );

        if (!isParticipant) {
            throw new Error('发送者不在会话中');
        }
    }

    // 初始化readBy对象，为所有参与者设置未读状态（发送者除外）
    const readBy = {};
    const readByUserIds = []
    conversation.participants.forEach(participantId => {
        // 发送者默认为已读
        if (senderId && participantId.toString() === senderId.toString()) {
            readBy[participantId.toString()] = true;
            readByUserIds.push(participantId)
        }
        // else {
        //     readBy[participantId.toString()] = false;
        //     readByUserIds.push(participantId)
        // }
    });

    // 创建消息
    const message = new Message({
        conversationId,
        senderId,
        readBy,
        readByUserIds,
        ...messageData
    });

    const savedMessage = await message.save();
    await savedMessage.populate('senderId', 'username')

    // 更新会话的最后消息信息
    conversation.lastMessage = savedMessage._id;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    return savedMessage;
};

/**
 * 用户分页获取会话中最新的消息列表
 * @param {string} conversationId - 会话ID
 * @param {number} page - 页码，默认为1
 * @param {number} limit - 每页数量，默认为20
 * @returns {Promise<object>} 包含消息列表和分页信息的对象
 */
const getConversationMessages = async (conversationId, page = 1, limit = 20, userId = null, allowAdmin = false) => {
    // 验证会话是否存在
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new Error('会话不存在');
    }

    if (userId && !allowAdmin) {
        // 如果传了用户ID, 则检查是否在会话中
        const isParticipant = conversation.participants.some(
            participantId => participantId.toString() === userId.toString()
        );

        if (!isParticipant) {
            throw new Error('用户不在会话中');
        }
    }

    const skip = (page - 1) * limit;

    // 获取消息总数
    const totalMessages = await Message.countDocuments({
        conversationId,
        deleted: false
    });

    // 获取消息列表（按时间倒序排列）
    const messages = await Message.find({
        conversationId,
        deleted: false
    })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('senderId', 'username');

    return {
        messages: messages.map(item => sanitizeMessage(item, allowAdmin)),
        pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalMessages / limit),
            totalMessages,
            hasNextPage: page < Math.ceil(totalMessages / limit),
            hasPrevPage: page > 1
        }
    };
};

/**
 * 用户获取会话最后的一条消息
 * @param {string} conversationId - 会话ID
 * @returns {Promise<object|null>} 最后一条消息
 */
const getLastMessageInConversation = async (conversationId, userId, allowAdmin = false) => {
    // 验证会话是否存在
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new Error('会话不存在');
    }

    // 如果传了用户ID, 则检查是否在会话中
    if (userId && !allowAdmin) {
        const isParticipant = conversation.participants.some(
            participantId => participantId.toString() === userId.toString()
        );

        if (!isParticipant) {
            throw new Error('用户不在会话中');
        }
    }

    const lastMessage = await Message.findOne({
        conversationId,
        deleted: false
    })
        .sort({ createdAt: -1 })
        .populate('senderId', 'username avatar');
    return sanitizeMessage(lastMessage, allowAdmin);
};

/**
 * 用户删除消息
 * @param {string} messageId - 消息ID
 * @param {string} userId - 用户ID（必须是消息发送者）
 * @returns {Promise<object>} 更新后的消息
 */
const deleteMessage = async (messageId, userId) => {
    const message = await Message.findById(messageId);
    if (!message) {
        throw new Error('消息不存在');
    }

    // 检查是否是消息发送者
    if (message.senderId.toString() !== userId.toString()) {
        throw new Error('无权限删除此消息');
    }

    // 软删除消息
    message.deleted = true;
    return await message.save();
};

/**
 * 用户离开会话
 * @param {string} conversationId - 会话ID
 * @param {string} userId - 用户ID
 * @returns {Promise<object>} 操作结果
 */
const leaveConversation = async (conversationId, userId) => {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new Error('会话不存在');
    }
    let users = conversation.participants.map(participantId => participantId.toString());
    // 从参与者列表中移除用户
    conversation.participants = conversation.participants.filter(
        participant => participant.toString() !== userId.toString()
    );

    // 如果会话只剩下一个参与者或没有参与者，则删除会话
    if (conversation.participants.length <= 1) {
        // 删除会话中的所有消息
        await Message.deleteMany({ conversationId: conversation._id });

        // 删除会话
        await Conversation.findByIdAndDelete(conversationId);
        return {
            conversationDeleted: true,
            latestUserIds: users
        }
    } else {
        // 保存更新后的会话
        await conversation.save();

        // 如果退出的是当前用户，则创建系统消息通知其他参与者
        const systemMessage = new Message({
            conversationId: conversation._id,
            isDeleted: false,
            senderId: userId,
            type: 'system',
            content: 'chat.system.userLeft'
        });
        await systemMessage.save();

        return {
            conversationDeleted: false,
            msg: systemMessage,
            latestUserIds: users
        };
    }
};

/**
 * 用户加入会话
 * @param {string} conversationId - 会话ID
 * @param {string} userId - 用户ID
 * @returns {Promise<object>} 操作结果
 */
const joinConversation = async (conversationId, userId) => {
    let conversation = null
    try {
        conversation = await Conversation.findById(conversationId);
    } catch (error) {
        throw new Error('chat.error.no_conversation');
    }
    if (!conversation) {
        throw new Error('chat.error.no_conversation');
    }

    // 检查用户是否已经在会话中
    const isAlreadyParticipant = conversation.participants.some(
        participant => participant.toString() === userId.toString()
    );

    if (isAlreadyParticipant) {
        throw new Error('chat.error.already_participant');
    }

    // 添加用户到参与者列表
    conversation.participants.push(userId);

    // 创建系统消息通知其他参与者
    // const systemMessage = new Message({
    //     conversationId: conversation._id,
    //     senderId: userId,
    //     type: 'system',
    //     content: '用户加入了会话'
    // });
    // await systemMessage.save();

    // 更新会话的最后消息信息
    // conversation.lastMessage = systemMessage._id;
    // conversation.lastMessageAt = new Date();
    await conversation.save();

    return {
        // joinMessage: systemMessage,
        // 最新的参与者列表
        participants: (await conversation.populate('participants')).participants.map(item => item._id)
    };
};

/**
 * 标记消息为已读
 * @param {string} messageId - 消息ID
 * @param {string} userId - 用户ID
 * @returns {Promise<object>} 更新后的消息
 */
const markMessageAsRead = async (messageId, userId) => {
    const message = await Message.findById(messageId);
    if (!message) {
        throw new Error('消息不存在');
    }

    // 更新用户的已读状态
    if (message.readBy.has(userId.toString())) {
        message.readBy.set(userId.toString(), true);
        await message.save();
    }

    return message;
};

/**
 * 标记会话中所有消息为已读
 * @param {string} conversationId - 会话ID
 * @param {string} userId - 用户ID
 * @returns {Promise<number>} 已更新的消息数量
 */
const markAllMessagesAsRead = async (conversationId, userId) => {
    // 查找会话中的所有未读消息
    const result = await Message.updateMany(
        {
            conversationId: conversationId,
            [`readBy.${userId}`]: false
        },
        {
            $set: { [`readBy.${userId}`]: true }
        }
    );

    return result.modifiedCount;
};

/**
 * 获取用户的未读消息数
 * @param {string} userId - 用户ID
 * @returns {Promise<object>} 各会话的未读消息数统计
 */
const getUserUnreadCount = async (userId) => {
    // 查找用户参与的所有会话
    const conversations = await Conversation.find({ participants: userId });
    const conversationIds = conversations.map(conv => conv._id);

    // 统计各会话中用户未读消息数
    const unreadCounts = {};

    for (const convId of conversationIds) {
        const count = await Message.countDocuments({
            conversationId: convId,
            [`readBy.${userId}`]: false,
            deleted: false
        });
        unreadCounts[convId] = count;
    }

    return unreadCounts;
};

// 删除指定会话的消息
const deleteConversationMessages = async (conversationId) => {
    await Message.deleteMany({ conversationId: conversationId });
};

// 删除所有消息
const deleteAllMessages = async () => {
    await Message.deleteMany({});
};

// 获取会话用户未读的消息 getUnReadMessages
const getUnReadMessages = async (conversationId, userId) => {
    // 验证会话是否存在
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new Error('会话不存在');
    }

    // 检查用户是否在会话中
    const isParticipant = conversation.participants.some(
        participant => participant.toString() === userId.toString()
    );

    if (!isParticipant) {
        throw new Error('用户不在会话中');
    }

    // 获取用户未读的消息
    const unreadMessages = await Message.find({
        conversationId,
        [`readBy.${userId}`]: false,
        deleted: false
    }).sort({ createdAt: 1 });

    // 同时更新用户的已读状态
    for (const message of unreadMessages) {
        message.readBy.set(userId, true);
        await message.save();
    }

    return unreadMessages.map(item => sanitizeMessage(item, false));
}
// 通过最晚消息时间, 获取N条以前的消息
const getMsgByTime = async (conversationId, userId, time, msgNum = 20, allowAdmin = false) => {
    // 楠岃瘉浼氳瘽鏄惁瀛樺湪
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new Error('会话不存在');
    }

    // 鍦ㄦ櫘閫氱敤鎴峰満鏅笅锛岄渶瑕佹鏌ョ敤鎴锋槸鍚﹀湪浼氳瘽涓?
    if (userId && !allowAdmin) {
        const isParticipant = conversation.participants.some(
            participant => participant.toString() === userId.toString()
        );

        if (!isParticipant) {
            throw new Error('用户不在会话中');
        }
    }

    // 鑾峰彇鐢ㄦ埛鐨勬秷鎭?
    const messages = await Message.find({
        conversationId,
        createdAt: { $lt: time },
        deleted: false
    }).sort({ createdAt: -1 }).limit(msgNum).populate('senderId', 'username')

    // 鍚屾椂鏇存柊鐢ㄦ埛鐨勫凡璇荤姸鎬?锛屽鏍稿憳鏌ョ湅鏃堕渶瑕佽烦杩囬槄璇诲洖鍐欙紝鍚﹀垯浼氬奖鍝嶄粙闈笂鐨勬湭璇荤姸鎬?
    if (!allowAdmin) {
        for (const message of messages) {
            message.readBy.set(userId, true);
            await message.save();
        }
    }
    return messages.map(item => sanitizeMessage(item, allowAdmin))
}

const markConMsgReadByConIdAndUid = async (conversationId, userId) => {
    await Message.updateMany(
        {
            conversationId: conversationId,
            readByUserIds: { $ne: userId }   // 只更新未包含该用户ID的消息
        },
        {
            $addToSet: { readByUserIds: userId }
        }
    )
}

export default {
    getUserConversationList,
    getVirConversationList,
    createConversation,
    sendMessageToConversation,
    getConversationMessages,
    getLastMessageInConversation,
    deleteMessage,
    leaveConversation,
    joinConversation,
    markMessageAsRead,
    markAllMessagesAsRead,
    getUserUnreadCount,
    deleteConversationMessages,
    deleteAllMessages,
    getUnReadMessages,
    getMsgByTime,
    markConMsgReadByConIdAndUid,
};



const sanitizeMessage = (message, allowAdmin = false) => {
    if (!message) {
        return message;
    }
    const plain = typeof message.toObject === 'function' ? message.toObject() : JSON.parse(JSON.stringify(message));
    if (!allowAdmin) {
        delete plain.translationZhCn;
    }
    return plain;
};


const sanitizeConversation = (conversation, allowAdmin = false) => {
    if (!conversation) {
        return conversation;
    }
    const plain = typeof conversation.toObject === 'function' ? conversation.toObject() : JSON.parse(JSON.stringify(conversation));
    if (plain.lastMessage) {
        plain.lastMessage = sanitizeMessage(plain.lastMessage, allowAdmin);
    }
    return plain;
};
