/**
 * 个人登录临时会话与 CookieJar 内存管理器
 * NOTE: 临时会话只保存在内存中，5分钟内未完成同步即被清理，防止会话和敏感 Cookie 长期驻存或被落盘存储。
 */

const { CookieJar } = require("tough-cookie");
const crypto = require("crypto");

// 5 分钟过期时间（300 秒）
const SESSION_TTL_MS = 5 * 60 * 1000;

// 内存会话映射
const sessionStore = new Map();

/**
 * 自动清理所有过期会话
 */
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessionStore.delete(sessionId);
    }
  }
}

/**
 * 创建一个新的登录会话，自动生成 32 位 Session ID
 * @returns {Object} 新创建的会话对象
 */
function createSession() {
  cleanExpiredSessions(); // 顺便进行一次清理

  const sessionId = crypto.randomBytes(16).toString("hex");
  const session = {
    sessionId,
    createdAt: Date.now(),
    authCookieJar: new CookieJar(),
    lcpz7WKu: "",
    execution: "",
    pwdEncryptSalt: "",
    lt: "",
    loginUrl: "",
    serviceUrl: "",
    verified: false, // 是否已经通过滑块校验
  };

  sessionStore.set(sessionId, session);
  return session;
}

/**
 * 获取指定 Session ID 的会话，若已过期则返回 null
 * @param {string} sessionId 会话 ID
 * @returns {Object|null} 会话对象
 */
function getSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    return null;
  }

  // 检查是否过期
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
}

/**
 * 销毁会话并清理其中所有敏感字段和 Cookie
 * @param {string} sessionId 会话 ID
 */
function destroySession(sessionId) {
  if (!sessionId) {
    return;
  }
  
  const session = sessionStore.get(sessionId);
  if (session) {
    // 显式清理敏感数据
    session.lcpz7WKu = null;
    session.execution = null;
    session.pwdEncryptSalt = null;
    session.lt = null;
    session.authCookieJar = null;
    sessionStore.delete(sessionId);
  }
}

module.exports = {
  createSession,
  getSession,
  destroySession,
};
