import express from "express";
import { sendMessage, getMessages } from "../controllers/message.controller.js";
import { verifyToken } from "../utils/jwt.js";

const router = express.Router();

/**
 * @route   POST /api/messages
 * @desc    发送一条消息
 * @access  Private
 */
router.post("/", verifyToken, sendMessage);

/**
 * @route   GET /api/messages/:conversationId
 * @desc    获取指定会话的消息记录
 * @access  Private
 */
router.get("/:conversationId", verifyToken, getMessages);

export default router;
