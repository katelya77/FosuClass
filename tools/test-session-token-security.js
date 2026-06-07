const assert = require("assert");

process.env.NODE_ENV = "production";
process.env.FOSU_SESSION_SECRET_CURRENT = "current-session-secret";
process.env.FOSU_SESSION_SECRET_PREVIOUS = "previous-session-secret";
process.env.FOSU_SESSION_SECRET_KID = "kid-current";
process.env.WECHAT_APPID = "wx-app-1";

const config = require("../server/src/config");
config.NODE_ENV = "production";
const {
  createSessionToken,
  verifySessionToken,
  verifySessionTokenDetailed,
} = require("../server/src/utils/apiSecurity");

let created = createSessionToken({ appid: "wx-app-1", openid: "openid-1" }, { ttlSeconds: 60 });
let payload = verifySessionToken(created.token, { appid: "wx-app-1" });
assert(payload, "current key token should verify");
assert.strictEqual(payload.version, 2);
assert.strictEqual(payload.kid, "kid-current");
assert.strictEqual(typeof payload.openidHash, "string");
assert.strictEqual(typeof payload.sessionIdHash, "string");

let wrongAppid = verifySessionTokenDetailed(created.token, { appid: "wx-app-2" });
assert.strictEqual(wrongAppid.valid, false);
assert.strictEqual(wrongAppid.code, "FOSU_SESSION_WRONG_APPID");

process.env.FOSU_SESSION_SECRET_CURRENT = "previous-session-secret";
const previousOnly = createSessionToken({ appid: "wx-app-1", openid: "openid-2" }, {
  ttlSeconds: 60,
});
process.env.FOSU_SESSION_SECRET_CURRENT = "rotated-current-session-secret";
payload = verifySessionToken(previousOnly.token, { appid: "wx-app-1" });
assert(payload, "previous key token should verify during rotation");

const malformed = verifySessionTokenDetailed("not-a-token");
assert.strictEqual(malformed.valid, false);
assert.strictEqual(malformed.code, "FOSU_SESSION_MALFORMED");

process.env.FOSU_SESSION_SECRET_CURRENT = "current-session-secret";
const realDateNow = Date.now;
Date.now = () => realDateNow() + 2 * 60 * 1000;
const expired = verifySessionTokenDetailed(created.token, { appid: "wx-app-1" });
Date.now = realDateNow;
assert.strictEqual(expired.valid, false);
assert.strictEqual(expired.code, "FOSU_SESSION_EXPIRED");

console.log("test-session-token-security passed");
