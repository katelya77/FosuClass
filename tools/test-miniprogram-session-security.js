const assert = require("assert");

let loginCalls = 0;
let requestCalls = 0;

global.wx = {
  getStorageSync() { return null; },
  setStorageSync() {},
  removeStorageSync() {},
  login(options) {
    loginCalls += 1;
    setTimeout(() => options.success({ code: "wx-code" }), 0);
  },
  request(options) {
    requestCalls += 1;
    setTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        sessionToken: "session-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        expiresIn: 3600,
        securityMode: "ticket",
        staticAccessMode: "ticket",
        serverTime: new Date().toISOString(),
      },
    }), 0);
  },
};

const service = require("../miniprogram/services/securitySessionService");

Promise.all([
  service.ensureSession({ forceRefresh: true }),
  service.ensureSession({ forceRefresh: true }),
  service.ensureSession({ forceRefresh: true }),
]).then((sessions) => {
  assert.strictEqual(loginCalls, 1, "session bootstrap should use singleflight wx.login");
  assert.strictEqual(requestCalls, 1, "session bootstrap should use singleflight request");
  assert(sessions.every((session) => session.sessionToken === "session-token"));
  return service.buildSessionHeaders("https://class.katelya.eu.org/api/fosu/app-config");
}).then((headers) => {
  assert.strictEqual(headers["X-Fosu-Session"], "session-token");
  console.log("test-miniprogram-session-security passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
