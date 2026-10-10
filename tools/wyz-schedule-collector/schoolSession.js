"use strict";
const fs = require("fs"), path = require("path");
const { readJson, acquireLock } = require("./runStore");
const { AUTH_ORIGIN, SCHOOL_ORIGIN } = require("../fosu-sync-client/schoolLoginProfile");
const {COOLDOWN_MS}=require('./schoolAuthState');
function fail(code) { return Object.assign(new Error(code), { code }); }
function transportCode(error) {
  if (/^(INVALID_CREDENTIALS|SCHOOL_[A-Z_]+|COLLECTOR_STOPPED)$/.test(error.code || "")) return error.code;
  if (error.name === "TimeoutError" || /timeout|timed out|ERR_TIMED_OUT/i.test(error.message || "")) return "SCHOOL_NETWORK_TIMEOUT";
  if (/certificate|SSL|TLS|ERR_CERT/i.test(error.message || "")) return "SCHOOL_TLS_OR_ORIGIN_REJECTED";
  return "SCHOOL_AUTH_TRANSPORT_FAILED";
}
function secureDirectory(directory, platform = process.platform) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || platform !== "win32" && (stat.uid !== 0 || stat.mode & 0o077)) throw fail("SCHOOL_AUTH_PERMISSIONS_REJECTED");
}
function validateSession(session) {
  if (!session || !Array.isArray(session.cookies) || !Array.isArray(session.origins) || Buffer.byteLength(JSON.stringify(session)) > 1024 * 1024) throw fail("SCHOOL_SESSION_INVALID");
  if (session.cookies.some(c => !c || typeof c.name !== "string" || typeof c.value !== "string" || c.domain && !["authserver.fosu.edu.cn", ".authserver.fosu.edu.cn", "100.fosu.edu.cn", ".100.fosu.edu.cn", ".fosu.edu.cn", "fosu.edu.cn"].includes(c.domain)) ||
      session.origins.some(o => !o || ![AUTH_ORIGIN, SCHOOL_ORIGIN].includes(o.origin))) throw fail("SCHOOL_SESSION_INVALID");
  return session;
}
function secureFile(file, platform = process.platform) {
  const stat = fs.lstatSync(file), parent = fs.lstatSync(path.dirname(file));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024*1024 || parent.isSymbolicLink() || !parent.isDirectory() || platform !== "win32" && (stat.uid !== 0 || stat.mode & 0o077 || parent.uid !== 0 || parent.mode & 0o077)) throw fail("SCHOOL_AUTH_PERMISSIONS_REJECTED");
}
function loadCredentials(file, platform) {
  secureFile(file, platform);
  const value = readJson(file, null);
  if (!value || value.schema !== 1 || typeof value.account !== "string" || !value.account.trim() || typeof value.password !== "string" || !value.password || typeof value.recoveryEnabled !== "boolean" || Object.keys(value).some(k => !["schema","account","password","recoveryEnabled","approvedUntil"].includes(k))) throw fail("SCHOOL_AUTH_CONFIGURATION_REJECTED");
  return value;
}
function allowedUrl(input) {
  try { const u = new URL(input); return [AUTH_ORIGIN,SCHOOL_ORIGIN].includes(u.origin) && !u.username && !u.password; } catch (_) { return false; }
}
function classifyPage(url, text) {
  if (!allowedUrl(url)) return "SCHOOL_TLS_OR_ORIGIN_REJECTED";
  if (require("../fosu-sync-client/schoolCasPage").credentialFailure(text)) return "INVALID_CREDENTIALS";
  if (require("../fosu-sync-client/schoolCasPage").explicitChallenge(text)) return "SCHOOL_SECURITY_CHALLENGE";
  if (new URL(url).origin === SCHOOL_ORIGIN && /教学一体化服务平台|我的桌面|学期理论课表/.test(text) && !/统一身份认证|密码登录/.test(text)) return "SESSION_VALID";
  if (new URL(url).origin === AUTH_ORIGIN || /统一身份认证|密码登录/.test(text)) return "SESSION_EXPIRED";
  return "SCHOOL_PAGE_CHANGED";
}
function assertSafeRuntime() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw fail("SCHOOL_TLS_OR_ORIGIN_REJECTED");
  if ((process.env.DEBUG || "").trim() || process.env.PWDEBUG && process.env.PWDEBUG !== "0" || /http|https|tls|net|undici|\*/i.test(process.env.NODE_DEBUG || "")) throw fail("SCHOOL_AUTH_DEBUG_REJECTED");
}
async function createAdapter(cfg, deps = {}) {
  return require("./schoolBrowserAdapter").createAdapter(cfg,deps);
}
async function checkSessionUnlocked(cfg, deps = {}) {
  // Explicit school access approval, even when no password is read or submitted.
  if (deps.approved !== true) throw fail("SCHOOL_AUTH_APPROVAL_REQUIRED");
  if (deps.signal && deps.signal.aborted) throw fail("COLLECTOR_STOPPED");
  if (!fs.existsSync(cfg.sessionPath)) return { status:"SESSION_EXPIRED",schoolLoginAttempts:0,sessionChanged:false };
  secureFile(cfg.sessionPath, deps.platform);
  const adapter = await (deps.createAdapter || createAdapter)(cfg, deps);
  try {
    const status = await adapter.check(cfg.sessionPath);
    if (!["SESSION_VALID", "SESSION_EXPIRED"].includes(status)) throw fail(/^(INVALID_CREDENTIALS|SCHOOL_[A-Z_]+)$/.test(status || "") ? status : "SCHOOL_SESSION_INVALID");
    return { status,schoolLoginAttempts:0,sessionChanged:false };
  } catch (error) {
    throw Object.assign(fail(transportCode(error)),{diagnostic:error.diagnostic});
  } finally { await adapter.close(); }
}
async function ensureSessionUnlocked(cfg, deps = {}) {
  const credentialsPath = cfg.schoolCredentialsPath || "/etc/fosuclass/school-auth.json";
  if (!fs.existsSync(credentialsPath)) return { status:"manual-session", schoolLoginAttempts:0 };
  const credentials = loadCredentials(credentialsPath, deps.platform);
  if (!credentials.recoveryEnabled && !deps.manualRecovery) return { status:"manual-session",schoolLoginAttempts:0 };
  const now = (deps.now || Date.now)();
  if (deps.approved !== true && !(credentials.recoveryEnabled && Date.parse(credentials.approvedUntil || "") > now)) throw fail("SCHOOL_AUTH_APPROVAL_REQUIRED");
  const lifecycle=require("./schoolAuthState").lifecycle(cfg,deps);
  lifecycle.check({budget:false});
  const adapter = await (deps.createAdapter || createAdapter)(cfg, deps);
  try {
    const status = await adapter.check(cfg.sessionPath);
    if (status === "SESSION_VALID") return { status,schoolLoginAttempts:0 };
    if (status !== "SESSION_EXPIRED") throw fail(status);
    lifecycle.check();
    const session = await adapter.login(credentials,lifecycle.hooks);
    if (deps.signal && deps.signal.aborted) throw fail("COLLECTOR_STOPPED");
    validateSession(session);
    const candidate = cfg.sessionPath+".candidate";
    if (fs.existsSync(candidate)) throw fail("SCHOOL_SESSION_CANDIDATE_EXISTS");
    fs.writeFileSync(candidate,JSON.stringify(session),{ mode:0o600,flag:"wx" });
    try {
      if (await adapter.check(candidate) !== "SESSION_VALID") throw fail("SCHOOL_SESSION_INVALID");
      fs.renameSync(candidate,cfg.sessionPath);
    } finally { if (fs.existsSync(candidate)) fs.unlinkSync(candidate); }
    lifecycle.success(cfg.loginProfile || "mobile");
    return { status:"SESSION_RECOVERED",schoolLoginAttempts:lifecycle.attempts() };
  } catch (error) {
    // Only allowlisted codes persist; browser URLs/HTML/credentials never leave this module.
    const code = transportCode(error);
    lifecycle.failure(code,error.diagnostic);
    throw Object.assign(fail(code),{diagnostic:error.diagnostic});
  } finally { await adapter.close(); }
}
async function withSessionLock(cfg, deps, work) {
  secureDirectory(cfg.dataRoot, deps.platform);
  const unlock = deps.sessionLockHeld ? () => {} : acquireLock(cfg.dataRoot, "school-session.lock");
  try { return await work(); } finally { unlock(); }
}
function checkSession(cfg, deps = {}) {
  // Missing files are a local fact; do not create a browser or lock for this case.
  if (!fs.existsSync(cfg.sessionPath)) return checkSessionUnlocked(cfg, deps);
  return withSessionLock(cfg, deps, () => checkSessionUnlocked(cfg, deps));
}
function ensureSession(cfg, deps = {}) {
  if (!fs.existsSync(cfg.schoolCredentialsPath || "/etc/fosuclass/school-auth.json")) return ensureSessionUnlocked(cfg, deps);
  return withSessionLock(cfg, deps, () => ensureSessionUnlocked(cfg, deps));
}
async function interactiveSession(cfg, deps = {}) {
  if (deps.approved !== true) throw fail("SCHOOL_ACCESS_NOT_AUTHORIZED");
  return withSessionLock(cfg, deps, async () => {
    secureDirectory(path.dirname(cfg.sessionPath), deps.platform);
    if (deps.signal && deps.signal.aborted) throw fail("COLLECTOR_STOPPED");
    const checked = await checkSessionUnlocked(cfg, { ...deps, approved: true });
    if (checked.status === "SESSION_VALID" && await deps.confirmReuse()) return { ...checked, status: "SESSION_REUSED", loginProfile: cfg.loginProfile || "mobile" };
    const lifecycle=require("./schoolAuthState").lifecycle(cfg,deps);
    lifecycle.check();
    // No school-auth.json is read/written. Credentials exist only in this process.
    let credentials, adapter;
    try {
      adapter = await (deps.createAdapter || createAdapter)(cfg, deps);
      // Detect local page adaptation failures before requesting credentials.
      if(adapter.prepare)await adapter.prepare();
      credentials = await deps.readCredentials();
      if (!credentials || typeof credentials.account !== "string" || !credentials.account.trim() || typeof credentials.password !== "string" || !credentials.password) throw fail("SCHOOL_AUTH_INPUT_REQUIRED");
      const session = validateSession(await adapter.login(credentials,lifecycle.hooks));
      credentials.account = ""; credentials.password = ""; credentials = null;
      if (deps.signal && deps.signal.aborted) throw fail("COLLECTOR_STOPPED");
      const candidate = cfg.sessionPath + ".candidate";
      if (fs.existsSync(candidate)) throw fail("SCHOOL_SESSION_CANDIDATE_EXISTS");
      const fd = fs.openSync(candidate, "wx", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(session)); fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      try {
        secureFile(candidate, deps.platform);
        if (await adapter.check(candidate) !== "SESSION_VALID") throw fail("SCHOOL_SESSION_INVALID");
        if (deps.signal && deps.signal.aborted) throw fail("COLLECTOR_STOPPED");
        if (fs.existsSync(cfg.sessionPath)) secureFile(cfg.sessionPath, deps.platform);
        fs.renameSync(candidate, cfg.sessionPath);
        if ((deps.platform || process.platform) !== "win32") {
          const parent = fs.openSync(path.dirname(cfg.sessionPath), "r");
          try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
        }
      } finally { if (fs.existsSync(candidate)) fs.unlinkSync(candidate); }
      lifecycle.success(cfg.loginProfile || "mobile");
      return { status: "SESSION_SAVED", schoolLoginAttempts: lifecycle.attempts(), schoolAuthRequests: adapter.stats ? adapter.stats().schoolRequests : null, sessionChanged: true, passwordPersisted: false, loginProfile: cfg.loginProfile || "mobile" };
    } catch (error) {
      const code = transportCode(error);
      if (adapter) lifecycle.failure(code,error.diagnostic);
      throw Object.assign(fail(code),{diagnostic:error.diagnostic});
    } finally {
      if (credentials) { credentials.account = ""; credentials.password = ""; }
      if (adapter) await adapter.close();
    }
  });
}
module.exports = { COOLDOWN_MS,allowedUrl,checkSession,classifyPage,createAdapter,ensureSession,interactiveSession,loadCredentials,secureFile,secureDirectory,transportCode,validateSession,assertSafeRuntime };
