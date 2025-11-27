import express from "express";
import { getUser, getUserCid } from "../controllers/auth.controller.js";

const router = express.Router();

/**
 * 需要主系统触发
 */
router.get("/user", getUser);

router.get("/user/cid", getUserCid);

export default router;
