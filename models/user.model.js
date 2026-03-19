import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  // 主系统的userid
  uid: { type: Number, unique: true },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  online: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now() },
}, { timestamps: true });

export default mongoose.model("User", userSchema);
