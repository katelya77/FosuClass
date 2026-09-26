const crypto = require("crypto");
const axios = require("axios");
const config = require("../config");

let exchangeOverride = null;

function devOpenid(jsCode) {
  return `dev-${crypto.createHash("sha256").update(String(jsCode || "")).digest("hex").slice(0, 24)}`;
}

async function exchangeCode(code) {
  const jsCode = String(code || "").trim();
  if (!jsCode) {
    const error = new Error("WX_CODE_REQUIRED");
    error.code = "WX_CODE_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  if (typeof exchangeOverride === "function") {
    return exchangeOverride(jsCode);
  }

  const appid = process.env.WECHAT_APPID || process.env.WX_APPID || "";
  const secret = process.env.WECHAT_APPSECRET || process.env.WX_APPSECRET || "";
  if (appid && secret) {
    const response = await axios.get("https://api.weixin.qq.com/sns/jscode2session", {
      params: {
        appid,
        secret,
        js_code: jsCode,
        grant_type: "authorization_code",
      },
      timeout: Number(process.env.WECHAT_SESSION_TIMEOUT_MS || 5000) || 5000,
    });
    if (!response.data || response.data.errcode || !response.data.openid) {
      const error = new Error("WECHAT_SESSION_FAILED");
      error.code = "WECHAT_SESSION_FAILED";
      error.statusCode = 502;
      throw error;
    }
    return { appid, openid: String(response.data.openid) };
  }
  if (config.NODE_ENV !== "production") {
    return { appid: appid || "dev-appid", openid: devOpenid(jsCode) };
  }
  const error = new Error("WECHAT_SESSION_NOT_CONFIGURED");
  error.code = "WECHAT_SESSION_NOT_CONFIGURED";
  error.statusCode = 503;
  throw error;
}

function setExchangeForTests(fn) {
  exchangeOverride = typeof fn === "function" ? fn : null;
}

function resetForTests() {
  exchangeOverride = null;
}

module.exports = {
  exchangeCode,
  resetForTests,
  setExchangeForTests,
};
