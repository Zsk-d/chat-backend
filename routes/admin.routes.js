import express from "express";
import { getOnlineByUids, searchConversations, searchMessages, setVirOnlineStatus } from "../controllers/admin.chat.controller.js";
import { internalTokenMiddleware } from "../middlewares/auth.internalTokenMiddleware.js";

const router = express.Router();

router.post("/chat/online", internalTokenMiddleware, getOnlineByUids);
router.post("/chat/vir/status", internalTokenMiddleware, setVirOnlineStatus);
router.post("/chat/conversations", internalTokenMiddleware, searchConversations);
router.post("/chat/messages", internalTokenMiddleware, searchMessages);

export default router;
