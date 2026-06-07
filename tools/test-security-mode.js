const assert = require("assert");

process.env.NODE_ENV = "production";
process.env.FOSU_SECURITY_MODE = "observe";
delete process.env.FOSU_SESSION_SECRET_CURRENT;
delete process.env.FOSU_STATIC_TICKET_SECRET_CURRENT;

const securityModeService = require("../server/src/services/securityModeService");
const config = require("../server/src/config");
config.NODE_ENV = "production";

let status = securityModeService.getSecurityMode();
assert.strictEqual(status.mode, "observe");
assert.strictEqual(status.observeOnly, true);
assert.strictEqual(status.configurationValid, true, "observe should allow startup with warnings");

process.env.FOSU_SECURITY_MODE = "session";
status = securityModeService.getSecurityMode();
assert.strictEqual(status.mode, "session-enforce");
assert.strictEqual(status.legacyMode, "session");
assert.strictEqual(status.requireDynamicSession, true);
assert.strictEqual(status.configurationValid, false, "session mode should require session secret and WeChat config in production");

process.env.WECHAT_APPID = "wx-test";
process.env.WECHAT_APPSECRET = "wechat-secret";
process.env.FOSU_SESSION_SECRET_CURRENT = "session-secret-current";
status = securityModeService.getSecurityMode();
assert.strictEqual(status.configurationValid, true, "session mode should be valid after required session config");

process.env.FOSU_SECURITY_MODE = "ticket";
status = securityModeService.getSecurityMode();
assert.strictEqual(status.mode, "ticket-enforce");
assert.strictEqual(status.legacyMode, "ticket");
assert.strictEqual(status.requireStaticTicket, true);
assert.strictEqual(status.configurationValid, false, "ticket mode should require static ticket secret and OpenResty ticket mode");

process.env.FOSU_STATIC_TICKET_SECRET_CURRENT = "static-ticket-secret-current";
process.env.FOSU_OPENRESTY_STATIC_SECURITY_MODE = "ticket";
status = securityModeService.getSecurityMode();
assert.strictEqual(status.configurationValid, true, "ticket mode should be valid after static secret and OpenResty mode");

process.env.FOSU_SECURITY_MODE = "session-canary";
status = securityModeService.getSecurityMode();
assert.strictEqual(status.mode, "session-canary");
assert.strictEqual(status.canarySession, true);
assert.strictEqual(status.requireDynamicSession, false, "session-canary should not become full enforcement by itself");

process.env.FOSU_SECURITY_MODE = "ticket-canary";
status = securityModeService.getSecurityMode();
assert.strictEqual(status.mode, "ticket-canary");
assert.strictEqual(status.requireDynamicSession, true);
assert.strictEqual(status.requireStaticTicket, false, "ticket-canary should not claim static ticket enforcement");

console.log("test-security-mode passed");
