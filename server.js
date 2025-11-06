import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import { initSocket } from "./socket/chat.socket.js";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import messageRoutes from "./routes/message.routes.js";

import { getLogger } from './utils/logger.js'

const logger = getLogger();

dotenv.config();
const app = express();

// ===== Middleware =====
// app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(cors()); // 全开放
app.use(express.json());

// ===== Routes =====
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes);

// ===== Database =====
connectDB();

// ===== Create HTTP & Socket Server =====
const server = http.createServer(app);
initSocket(server); // 初始化 socket.io

// ===== Start Server =====
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => logger.info(`🚀 Server running on port ${PORT}`));

