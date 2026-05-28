/**
 * 配置文件：用于管理后端服务的所有环境变量和核心配置
 * 统一从 process.env 读取并提供默认值
 */

const path = require("path");
const dotenv = require("dotenv");

// NOTE: 载入当前 server 目录下的 .env 文件
dotenv.config({ path: path.join(__dirname, "../.env") });

const config = {
  // 运行环境: development | production
  NODE_ENV: process.env.NODE_ENV || "development",
  // 监听端口
  PORT: parseInt(process.env.PORT || "3000", 10),

  // API 公网域名起源
  PUBLIC_API_ORIGIN: process.env.PUBLIC_API_ORIGIN || "http://localhost:3000",

  // 强智教务网基础地址
  FOSU_BASE_URL: process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn",
  // 强智 CAS 统一认证地址
  FOSU_AUTH_URL: process.env.FOSU_AUTH_URL || "https://authserver.fosu.edu.cn",

  // 强智服务登录账号与密码
  FOSU_SERVICE_USERNAME: process.env.FOSU_SERVICE_USERNAME || "",
  FOSU_SERVICE_PASSWORD: process.env.FOSU_SERVICE_PASSWORD || "",

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
};

module.exports = config;
