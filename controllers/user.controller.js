import { User } from "../models/index.js";
import { getOnlineUserIds, getOnlineNum } from "../socket/chat.socket.js"; // 从 socket.js 导出在线用户 Map

/**
 * 获取所有用户
 */
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * 获取单个用户信息
 */
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-passwordHash");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * 搜索用户（按用户名或邮箱）
 */
export const searchUsers = async (req, res) => {
  try {
    const keyword = req.params.keyword;
    const regex = new RegExp(keyword, "i");
    const users = await User.find({
      $and: [
        { $or: [{ username: regex }, { email: regex }] }
      ]
    }).select("-passwordHash");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * 获取在线用户
 */
export const getOnlineUsers = async (req, res) => {
  try {
    const onlineIds = getOnlineUserIds();
    let onlineNUm = getOnlineNum()
    // const users = await User.find({ _id: { $in: onlineIds } }).select("username uid");
    res.json(onlineIds);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
