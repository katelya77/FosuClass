/**
 * 后端服务入口文件：初始化 Express 应用，挂载安全、跨域及限流中间件，挂载 API 路由并启动 HTTP 监听。
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const config = require("./config");
const { globalLimiter } = require("./utils/rateLimit");
const { safeLog } = require("./utils/safeLogger");

// 路由引入
const healthRouter = require("./routes/health");
const fosuRouter = require("./routes/fosu");
const adminRouter = require("./routes/admin");

const app = express();

// 1. 安全加固 (Helmet)
app.use(helmet());

// 2. CORS 跨域配置
const corsOptions = {
  origin: (origin, callback) => {
    // 允许没有 origin 的请求 (如移动端、curl、本地测试脚本)
    if (!origin) return callback(null, true);
    
    // 如果配置了通配符，或请求 Origin 在允许列表中
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. 挂载路由
app.use("/api/health", healthRouter);
app.use("/api/fosu", fosuRouter);
app.use("/api/admin/sync", adminRouter);

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
