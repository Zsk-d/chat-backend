import express from "express";
import { getUser, getUserCid, closeUser } from "../controllers/auth.controller.js";
import { internalTokenMiddleware } from "../middlewares/auth.internalTokenMiddleware.js";
const router = express.Router();

/**
 * 需要主系统触发
 */
router.get("/user", internalTokenMiddleware, getUser);
router.get("/user/cid", internalTokenMiddleware, getUserCid);
router.get("/user/close", internalTokenMiddleware, closeUser);

export default router;
