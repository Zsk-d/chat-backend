import mongoose from "mongoose";

/**
 * 消息模型
 * @property {ObjectId} conversationId - 会话ID
 * @property {ObjectId} senderId - 发送者ID
 * @property {ObjectId} receiverId - 接收者ID
 * @property {String} type - 消息类型，可选值为 text、image、file、system
 * @property {String} content - 消息内容
 * @property {String} status - 消息状态，可选值为 sent、delivered、read
 * @property {Boolean} deleted - 是否删除/撤回
 */
const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, enum: ["text", "image", "file", "system"], default: "text" },
  content: String,
  status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
  readBy: {
    type: Map,
    of: Boolean,
    default: {} // 保存每个用户的已读状态
  },
  deleted: { type: Boolean, default: false },
}, { timestamps: true });

// 索引
messageSchema.index(
  { conversationId: 1, deleted: 1, createdAt: -1 }
);

// 如果后面有按发送者查TA发过的消息，可加：
messageSchema.index(
  { senderId: 1, createdAt: -1 }
);

export default mongoose.model("Message", messageSchema);
