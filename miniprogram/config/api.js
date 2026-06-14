/**
 * 微信小程序 API 域名配置文件。
 *
 * 动态 API 与静态 Release Pack 源分开配置：Oracle 继续作为动态
 * API / 兼容 API 控制面，静态数据源由 staticOriginService 在
 * CloudBase Hosting 与 Oracle OpenResty 之间选择。
 */

// 生产环境自建 VPS 后端域名地址
const API_BASE_URL = "https://class.katelya.eu.org";
const ORACLE_API_BASE_URL = API_BASE_URL;
const ORACLE_STATIC_RELEASE_BASE_URL = `${ORACLE_API_BASE_URL}/static/releases`;
const ORACLE_RUNTIME_BASE_URL = `${ORACLE_API_BASE_URL}/static/runtime`;

// Backward-compatible alias for existing modules/tests. New code should use
// ORACLE_STATIC_RELEASE_BASE_URL or staticOriginService instead.
const STATIC_RELEASE_BASE_URL = ORACLE_STATIC_RELEASE_BASE_URL;

// 本地调试域名地址 (在开发者工具勾选“不校验合法域名”时可用)
// const API_BASE_URL = "http://localhost:3000";

module.exports = {
  API_BASE_URL,
  ORACLE_API_BASE_URL,
  ORACLE_STATIC_RELEASE_BASE_URL,
  ORACLE_RUNTIME_BASE_URL,
  STATIC_RELEASE_BASE_URL
};
