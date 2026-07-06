import userService from "../service/user.service.js";
import { closeUser as socketCloseUser } from "../socket/chat.socket.js"

export const getUser = async (req, res) => {
  try {
    const { uid, name, isAdmin } = req.query;
    let tokenRes = await userService.getUserToken(uid, name, isAdmin === 'true' || isAdmin === true)

    console.log(`获取TOKEN uid:${uid} name:${name}`);

    res.json({ ok: true, data: tokenRes.token });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getUserCid = async (req, res) => {
  try {
    const { uid } = req.query;
    let user = await userService.getUserByUid(uid)

    console.log(`获取cid uid:${uid}`);
    if (user) {
      res.json({ ok: true, data: user._id });
    } else {
      res.json({ ok: false, msg: 'chat.error.userNotExist' });
    }

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createVirUser = async (req, res) => {
  try {
    const { uid, username } = req.query;
    let user = await userService.createUser(uid, username, true)

    console.log(`获取cid uid:${uid}`);
    if (user) {
      res.json({ ok: true, data: user._id });
    } else {
      res.json({ ok: false, msg: '创建失败' });
    }

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const closeUser = async (req, res) => {
  try {
    const { uid } = req.query;
    let user = await userService.getUserByUid(uid)

    console.log(`获取cid uid:${uid}`);
    if (user) {
      await socketCloseUser(user._id.toString())
      res.json({ ok: true, data: user._id });
    } else {
      res.json({ ok: false, msg: 'chat.error.userNotExist' });
    }

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
