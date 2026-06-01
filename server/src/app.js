/**
 * 后端服务入口文件：初始化 Express 应用，挂载安全、跨域及限流中间件，挂载 API 路由并启动 HTTP 监听。
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const config = require("./config");
const { globalLimiter } = require("./utils/rateLimit");
const { safeLog } = require("./utils/safeLogger");

// 路由引入
const healthRouter = require("./routes/health");
const fosuRouter = require("./routes/fosu");
const adminRouter = require("./routes/admin");
const adminPageRouter = require("./routes/adminPages");
const contributeRouter = require("./routes/contribute");
const feedbackRouter = require("./routes/feedback");
const personalRouter = require("./routes/personal");
const relayRouter = require("./routes/relay");

const app = express();

// 1. 安全加固 (Helmet)
app.use(helmet());

// 2. CORS 跨域配置
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    if (
      config.CORS_ALLOWED_ORIGINS.includes("*") || 
      config.CORS_ALLOWED_ORIGINS.includes(origin) ||
      config.NODE_ENV === "development"
    ) {
      return callback(null, true);
    }
    
    safeLog("cors-rejected", { origin });
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};
app.use(cors(corsOptions));

// 3. 全局 API 访问频率限制
app.use(globalLimiter);

// 4. 解析请求体
app.use(express.json({ limit: "150mb" }));
app.use(express.urlencoded({ extended: true, limit: "150mb" }));

app.use(express.static(path.join(__dirname, "../public"), {
  maxAge: config.NODE_ENV === "production" ? "1h" : 0,
}));

app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    safeLog("payload-too-large", {
      path: req.path,
      method: req.method,
      limit: err.limit,
      length: err.length,
    });
    return res.status(413).json({
      success: false,
      code: "PAYLOAD_TOO_LARGE",
      message: "上传数据过大，请使用分块上传或缩小同步范围。",
    });
  }

  return next(err);
});

// 5. 挂载路由
app.use("/api/health", healthRouter);
app.use("/api/fosu", fosuRouter);
app.use("/api/fosu/personal", personalRouter);
app.use("/api/admin", adminRouter);
app.use("/admin", adminPageRouter);
app.use("/api/relay", relayRouter);
app.use("/api/contribute", contributeRouter);
app.use("/api/feedback", feedbackRouter);

// 6. 404 错误处理
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: "Requested resources not found.",
  });
});

// 7. 全局异常处理
app.use((err, req, res, next) => {
  safeLog("uncaught-error", { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    message: "Internal server error.",
    error: config.NODE_ENV === "development" ? err.message : undefined,
  });
});

// 8. 启动监听
app.listen(config.PORT, () => {
  console.log(`[FosuClass Server] Server is running at http://localhost:${config.PORT}`);
  console.log(`[FosuClass Server] Environment: ${config.NODE_ENV}`);
});

module.exports = app;
