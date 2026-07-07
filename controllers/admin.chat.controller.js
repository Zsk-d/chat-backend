import User from "../models/user.model.js";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import { emitAdminMessageTranslation, getOnlineUserIds, setVirtualUserOnlineState } from "../socket/chat.socket.js";

/**
 * POST /admin/chat/online
 * 查询给定主系统uid列表中当前在线的用户
 * Body: { uids: [1, 2, 3] }
 */
export const getOnlineByUids = async (req, res) => {
    try {
        const { uids } = req.body;
        if (!Array.isArray(uids) || uids.length === 0) {
            return res.json({ ok: true, data: [] });
        }

        // 查找这些uid对应的chat用户
        const chatUsers = await User.find({ uid: { $in: uids } }).select("_id uid online vir");
        const onlineSet = new Set(getOnlineUserIds());

        // 过滤出在线的uid
        const onlineUids = chatUsers
            .filter(u => onlineSet.has(u._id.toString()) || u.online)
            .map(u => u.uid);

        res.json({ ok: true, data: onlineUids });
    } catch (err) {
        console.error("getOnlineByUids error:", err);
        res.status(500).json({ ok: false, msg: err.message });
    }
};

/**
 * POST /admin/chat/conversations
 * 分页查询会话列表 (SearchReq结构)
 * Body: { page, pageSize, params: { participantUids: [], conversationId } }
 */
export const searchConversations = async (req, res) => {
    try {
        const { page = 1, pageSize = 20, params = {} } = req.body;
        const { participantUids, conversationId } = params;

        const query = {};

        // 按会话ID查询
        if (conversationId) {
            query._id = conversationId;
        }

        // 按参与者uid查询
        if (Array.isArray(participantUids) && participantUids.length > 0) {
            const chatUsers = await User.find({ uid: { $in: participantUids } }).select("_id online vir");
            if (chatUsers.length === 0) {
                return res.json({ ok: true, data: { total: 0, rows: [] } });
            }
            const chatIds = chatUsers.map(u => u._id);
            query.participants = { $all: chatIds };
        }

        const skip = (page - 1) * pageSize;
        const [total, conversations] = await Promise.all([
            Conversation.countDocuments(query),
            Conversation.find(query)
                .sort({ lastMessageAt: -1 })
                .skip(skip)
                .limit(pageSize)
                .populate("lastMessage")
                .lean()
        ]);

        // 收集所有参与者的chat _id, 批量查询User
        const allParticipantIds = [...new Set(conversations.flatMap(c => c.participants.map(p => p.toString())))];
        const participantUsers = await User.find({ _id: { $in: allParticipantIds } }).select("_id uid username online vir").lean();
        const userMap = new Map(participantUsers.map(u => [u._id.toString(), u]));

        const onlineSet = new Set(getOnlineUserIds());

        const rows = conversations.map(c => ({
            conversationId: c._id.toString(),
            type: c.type,
            name: c.name,
            participants: c.participants.map(p => {
                const u = userMap.get(p.toString());
                return {
                    uid: u ? u.uid : null,
                    username: u ? u.username : null,
                    online: onlineSet.has(p.toString()) || !!(u && u.online)
                };
            }),
            lastMessage: c.lastMessage ? {
                content: c.lastMessage.content,
                type: c.lastMessage.type,
                createdAt: c.lastMessage.createdAt
            } : null,
            lastMessageAt: c.lastMessageAt,
            createdAt: c.createdAt
        }));

        res.json({ ok: true, data: { total, rows } });
    } catch (err) {
        console.error("searchConversations error:", err);
        res.status(500).json({ ok: false, msg: err.message });
    }
};

/**
 * POST /admin/chat/vir/status
 * 手动切换虚拟用户在线状态
 * Body: { uid, online }
 */
export const setVirOnlineStatus = async (req, res) => {
    try {
        const { uid, online } = req.body;
        if (uid === undefined || uid === null) {
            return res.status(400).json({ ok: false, msg: "uid is required" });
        }
        const user = await setVirtualUserOnlineState(uid, !!online);
        res.json({ ok: true, data: { uid: user.uid, online: !!user.online } });
    } catch (err) {
        console.error("setVirOnlineStatus error:", err);
        res.status(500).json({ ok: false, msg: err.message });
    }
};

/**
 * POST /admin/chat/messages
 * 分页查询会话消息 (SearchReq结构)
 * Body: { page, pageSize, params: { conversationId, sort } }
 */
export const searchMessages = async (req, res) => {
    try {
        const { page = 1, pageSize = 50, params = {} } = req.body;
        const { conversationId, sort = "asc" } = params;

        if (!conversationId) {
            return res.status(400).json({ ok: false, msg: "conversationId is required" });
        }

        const query = {
            conversationId,
            deleted: { $ne: true }
        };

        const sortOrder = sort === "desc" ? -1 : 1;
        const skip = (page - 1) * pageSize;

        const [total, messages] = await Promise.all([
            Message.countDocuments(query),
            Message.find(query)
                .sort({ createdAt: sortOrder })
                .skip(skip)
                .limit(pageSize)
                .lean()
        ]);

        // 收集所有senderId, 批量查询User
        const senderIds = [...new Set(messages.map(m => m.senderId.toString()))];
        const senders = await User.find({ _id: { $in: senderIds } }).select("_id uid username").lean();
        const senderMap = new Map(senders.map(u => [u._id.toString(), u]));

        const rows = messages.map(m => {
            const sender = senderMap.get(m.senderId.toString());
            return {
                messageId: m._id.toString(),
                senderUid: sender ? sender.uid : null,
                senderName: sender ? sender.username : null,
                content: m.content,
                translationZhCn: m.translationZhCn || '',
                type: m.type,
                status: m.status,
                createdAt: m.createdAt
            };
        });

        res.json({ ok: true, data: { total, rows } });
    } catch (err) {
        console.error("searchMessages error:", err);
        res.status(500).json({ ok: false, msg: err.message });
    }
};

/**
 * POST /admin/chat/message/translate
 * 保存消息中文翻译并广播给管理员
 */
export const translateMessage = async (req, res) => {
    try {
        const { conversationId, messageId, translationZhCn } = req.body;
        if (!conversationId || !messageId) {
            return res.status(400).json({ ok: false, msg: "conversationId and messageId are required" });
        }
        const translation = String(translationZhCn || "").trim();
        if (!translation) {
            return res.status(400).json({ ok: false, msg: "translationZhCn is required" });
        }

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ ok: false, msg: "message not found" });
        }
        if (message.conversationId?.toString() !== conversationId.toString()) {
            return res.status(400).json({ ok: false, msg: "conversation mismatch" });
        }

        message.translationZhCn = translation;
        await message.save();

        await emitAdminMessageTranslation({
            conversationId,
            messageId: message._id.toString(),
            translationZhCn: translation
        });

        res.json({ ok: true, data: { conversationId, messageId: message._id.toString(), translationZhCn: translation } });
    } catch (err) {
        console.error("translateMessage error:", err);
        res.status(500).json({ ok: false, msg: err.message });
    }
};
