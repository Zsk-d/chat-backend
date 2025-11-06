import { User } from "../models/index.js";
import { signToken } from "../utils/jwt.js";

/**
 * 获取用户通信token，如果用户不存在则创建用户
 * @param {number} uid - 主系统的用户ID
 * @param {string} username - 用户名
 * @returns {Promise<object>} 包含token和user信息的对象
 */
const getUserToken = async (uid, username) => {
    // 查找用户是否存在
    let user = await User.findOne({ uid });

    // 如果用户不存在，则创建新用户
    if (!user) {
        user = new User({ uid, username });
        await user.save();
    }

    // 生成token
    const token = signToken({ id: user._id, uid: uid });

    return { token };
};

/**
 * 通过uid获取用户
 * @param {number} uid - 主系统的用户ID
 * @returns {Promise<object|null>} 用户信息
 */
const getUserByUid = async (uid) => {
    return await User.findOne({ uid });
};

/**
 * 通过uid更新用户名
 * @param {number} uid - 主系统的用户ID
 * @param {string} username - 新用户名
 * @returns {Promise<object>} 更新后的用户信息
 */
const updateUsernameByUid = async (uid, username) => {
    const user = await User.findOneAndUpdate(
        { uid },
        { username },
        { new: true, runValidators: true }
    );

    if (!user) {
        throw new Error('用户不存在');
    }

    return user;
};

// 删除所有用户
const deleteAllUsers = async () => {
    await User.deleteMany({});
};

export default {
    getUserToken,
    getUserByUid,
    updateUsernameByUid,
    deleteAllUsers,
};