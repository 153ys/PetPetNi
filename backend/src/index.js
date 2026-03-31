import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// 1. 導入路徑與服務 (New Structure)
import chatRoutes from "./routes/chat.js";
import aiRoutes from "./routes/ai.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import eventRoutes from "./routes/event.js";
import socialRoutes from "./routes/social.js";
import followRoutes from "./routes/followRoutes.js";
import matchRoutes from "./routes/match.js";

if (process.env.NODE_ENV !== "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
} else {
  dotenv.config(); // 生產環境直接讀取
}

const app = express();

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-user-id"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.use("/api/chat", chatRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/follow", followRoutes);
app.use("/api/match", matchRoutes);
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "PetPetNi API Server is ALIVE!",
    env: process.env.NODE_ENV,
  });
});

if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 本地測試運行中：http://localhost:${PORT}`);
  });
}

export default app;
