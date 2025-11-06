import { Message, Conversation } from "../models/index.js";

/**
 * 发送消息
 */
export const sendMessage = async (req, res) => {
  try {
    const { conversationId, receiverId, text } = req.body;
    const senderId = req.user.id; // 从 JWT 提取（中间件注入）

    // 1️⃣ 保存消息
    const message = await Message.create({
      conversationId,
      senderId,
      receiverId,
      text
    });

    // 2️⃣ 更新会话最后一条消息
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: text,
      updatedAt: Date.now()
    });

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * 获取会话的所有消息
 */
export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const messages = await Message.find({ conversationId })
      .sort({ createdAt: 1 }); // 按时间升序
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
