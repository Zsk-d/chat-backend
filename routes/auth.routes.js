import express from "express";
import { getUser } from "../controllers/auth.controller.js";

const router = express.Router();

/**
 * 需要主系统触发
 */
router.get("/user", getUser);

export default router;
