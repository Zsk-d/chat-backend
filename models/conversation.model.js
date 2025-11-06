import mongoose from "mongoose";
/**
 * 会话模型
 * @property {string} name - 会话名称, 私聊时为用户名，群聊时为群组名称
 * @property {string} type - 会话类型, 私有的/公开群组
 * @property {Array<ObjectId>} participants - 参与者
 * @property {ObjectId} lastMessage - 最后一条消息
 * @property {Date} lastMessageAt - 最后一条消息的时间
 */
const conversationSchema = new mongoose.Schema({
  name: String,
  // 会话类型, 私有的/公开群组
  type: { type: String, enum: ["private", "group"], default: "private" },
  // 参与者
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // 最后一条消息的msgid
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  unreadCount: { 
    type: Map, 
    of: Number, 
    default: {}  // 保存每个用户的未读消息数
  },
  // 最后一条消息的时间
  lastMessageAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("Conversation", conversationSchema);
