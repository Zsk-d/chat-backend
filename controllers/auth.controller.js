import userService from "../service/user.service.js";

export const getUser = async (req, res) => {
  try {
    const { uid, name } = req.query;
    let tokenRes = await userService.getUserToken(uid, name)

    res.json(tokenRes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
