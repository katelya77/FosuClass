/**
 * 微信小程序 API 域名配置文件
 */

// 生产环境自建 VPS 后端域名地址
const API_BASE_URL = "https://class.katelya.eu.org";
const STATIC_RELEASE_BASE_URL = `${API_BASE_URL}/static/releases`;

// 本地调试域名地址 (在开发者工具勾选“不校验合法域名”时可用)
// const API_BASE_URL = "http://localhost:3000";

module.exports = {
  API_BASE_URL,
  STATIC_RELEASE_BASE_URL
};
