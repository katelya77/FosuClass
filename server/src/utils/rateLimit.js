/**
 * 限流中间件：基于 express-rate-limit 模块限制接口访问频率，防止恶意高频刷接口。
 */

const rateLimit = require("express-rate-limit");

/**
 * 全局 API 限流限制器
 * 每个 IP 每分钟最多 60 次请求
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 60,
  message: {
    success: false,
    message: "请求过于频繁，请稍后再试",
  },
  standardHeaders: true, // 返回标准 RateLimit 响应头
  legacyHeaders: false, // 禁用 X-RateLimit 响应头
});

/**
 * 课表等重资源查询接口限流限制器
 * 每个 IP 每分钟最多 20 次请求
 */
const scheduleLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 20,
  message: {
    success: false,
    message: "请求过于频繁，请稍后再试",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  globalLimiter,
  scheduleLimiter,
};
