import express from "express";
import {
  getAllUsers,
  getUserById,
  searchUsers,
  getOnlineUsers
} from "../controllers/user.controller.js";
import { internalTokenMiddleware } from "../middlewares/auth.internalTokenMiddleware.js";

const router = express.Router();

/**
 * @route   GET /api/users
 * @desc    获取所有用户（除自己）
 * @access  Private
 */
router.get("/", internalTokenMiddleware, getAllUsers);

/**
 * @route   GET /api/users/:id
 * @desc    获取单个用户信息
 * @access  Private
 */
router.get("/:id", internalTokenMiddleware, getUserById);

/**
 * @route   GET /api/users/search/:keyword
 * @desc    搜索用户（按用户名或邮箱）
 * @access  Private
 */
router.get("/search/:keyword", internalTokenMiddleware, searchUsers);

/**
 * @route   GET /api/users/online/list
 * @desc    获取当前在线用户列表
 * @access  Private
 */
router.get("/online/list", internalTokenMiddleware, getOnlineUsers);

export default router;
