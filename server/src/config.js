/**
 * 配置文件：用于管理后端服务的所有环境变量和核心配置
 * 统一从 process.env 读取并提供默认值
 */

const path = require("path");
const dotenv = require("dotenv");
const crypto = require("crypto");

// NOTE: 载入当前 server 目录下的 .env 文件
dotenv.config({ path: path.join(__dirname, "../.env") });

const config = {
  // 运行环境: development | production
  NODE_ENV: process.env.NODE_ENV || "development",
  // 监听端口
  PORT: parseInt(process.env.PORT || "3000", 10),

  // API 公网域名起源
  PUBLIC_API_ORIGIN: process.env.PUBLIC_API_ORIGIN || "http://localhost:3000",
  FOSU_API_BASE_URL: process.env.FOSU_API_BASE_URL || process.env.PUBLIC_API_ORIGIN || "http://localhost:3000",
  FOSU_STATIC_RELEASE_BASE_URL: process.env.FOSU_STATIC_RELEASE_BASE_URL || "/static/releases",
  STATIC_SIGNED_URL_ENABLED: process.env.STATIC_SIGNED_URL_ENABLED === "true",

  // 数据源模式: cache-first | realtime | disabled
  DATA_SOURCE_MODE: process.env.DATA_SOURCE_MODE || "cache-first",

  // 管理端同步 API Token。如果未配置则根据密码自动安全派生，保证同步客户端正常访问
  ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN || (process.env.ADMIN_PASSWORD
    ? crypto.createHash("sha256").update(process.env.ADMIN_PASSWORD + "fosu_api_salt").digest("hex")
    : ""),

  // Web 后台登录凭据。ADMIN_API_TOKEN 仅保留给同步工具使用。
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || "",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",

  // 强智教务网基础地址
  FOSU_BASE_URL: process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn",
  // 强智 CAS 统一认证地址
  FOSU_AUTH_URL: process.env.FOSU_AUTH_URL || "https://authserver.fosu.edu.cn",

  // 缓存生存时间 (单位: 秒)
  CACHE_TTL: {
    CATALOG: parseInt(process.env.CACHE_TTL_CATALOG || "600", 10),
    MAJOR: parseInt(process.env.CACHE_TTL_MAJOR || "1800", 10),
    SCHEDULE: parseInt(process.env.CACHE_TTL_SCHEDULE || "600", 10),
  },

  // 请求教务系统的超时时间 (毫秒)
  REQUEST_TIMEOUT_MS: parseInt(process.env.REQUEST_TIMEOUT_MS || "15000", 10),

  // CORS 跨域允许的来源
  CORS_ALLOWED_ORIGINS: (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  FOSU_ALLOWED_ADMIN_ORIGINS: (process.env.FOSU_ALLOWED_ADMIN_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  FOSU_ALLOWED_PUBLIC_ORIGINS: (process.env.FOSU_ALLOWED_PUBLIC_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  // 校园代理 Agent 配置
  CAMPUS_AGENT_ENABLED: process.env.CAMPUS_AGENT_ENABLED === "true",
  CAMPUS_AGENT_BASE_URL: process.env.CAMPUS_AGENT_BASE_URL || "",
  CAMPUS_AGENT_TOKEN: process.env.CAMPUS_AGENT_TOKEN || "",
};

module.exports = config;
