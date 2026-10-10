"use strict";
const fs = require("fs"), path = require("path");
const { readJson, writeJsonAtomic } = require("./runStore");
const AUTH_ORIGIN = "https://authserver.fosu.edu.cn", SCHOOL_ORIGIN = "https://100.fosu.edu.cn";
const COOLDOWN_MS = 30 * 60 * 1000, DAY_MS = 24 * 60 * 60 * 1000;
function fail(code) { return Object.assign(new Error(code), { code }); }
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
  if (/密码错误|用户名或密码|账号或密码|认证失败|不存在|incorrect/i.test(text)) return "INVALID_CREDENTIALS";
  if (/验证码|滑块|拼图|人机|风险|风控|安全验证|captcha|risk control/i.test(text)) return "SCHOOL_SECURITY_CHALLENGE";
  if (new URL(url).origin === SCHOOL_ORIGIN && /教学一体化服务平台|我的桌面|学期理论课表/.test(text) && !/统一身份认证|密码登录/.test(text)) return "SESSION_VALID";
  if (new URL(url).origin === AUTH_ORIGIN || /统一身份认证|密码登录/.test(text)) return "SESSION_EXPIRED";
  return "SCHOOL_PAGE_CHANGED";
}
async function createAdapter(cfg, deps = {}) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw fail("SCHOOL_TLS_OR_ORIGIN_REJECTED");
  if ((process.env.DEBUG || "").trim() || process.env.PWDEBUG && process.env.PWDEBUG !== "0" || /http|https|tls|net|undici|\*/i.test(process.env.NODE_DEBUG || "")) throw fail("SCHOOL_AUTH_DEBUG_REJECTED");
  const chromium = deps.chromium || require("../fosu-sync-client/node_modules/playwright").chromium;
  // A container browser must be integrated separately; never pass credentials to a container command line.
  if (require("./browserRuntime").runtime(cfg.dataRoot).mode !== "native") throw fail("SCHOOL_AUTH_NATIVE_BROWSER_REQUIRED");
  const browser = await chromium.launch({ headless: true, timeout: 30000, args: ["--no-proxy-server"] });
  const contexts = [];
  const abort = () => browser.close().catch(() => {});
  if (deps.signal) { if (deps.signal.aborted) { await browser.close(); throw fail("COLLECTOR_STOPPED"); } deps.signal.addEventListener("abort", abort, { once: true }); }
  async function pageFor(storageState) {
    const context = await browser.newContext({ ignoreHTTPSErrors: false, ...(storageState ? { storageState } : {}) });
    contexts.push(context);
    await context.route("**/*", route => allowedUrl(route.request().url()) ? route.continue() : route.abort("blockedbyclient"));
    return { context, page: await context.newPage() };
  }
  async function inspect(page) { return classifyPage(page.url(), await page.locator("body").innerText()); }
  return {
    async check(sessionPath) {
      if (!fs.existsSync(sessionPath)) return "SESSION_EXPIRED";
      secureFile(sessionPath);
      const { page } = await pageFor(sessionPath);
      await page.goto(SCHOOL_ORIGIN+"/framework/xsMain.jsp", { waitUntil:"domcontentloaded", timeout:25000 });
      return inspect(page);
    },
    async login(credentials) {
      // Fresh context; never merge old cookies with a new account/session.
      const { context, page } = await pageFor();
      const service = SCHOOL_ORIGIN+"/caslogin.jsp?kstzType=null";
      await page.goto(AUTH_ORIGIN+"/authserver/login?type=userNameLogin&service="+encodeURIComponent(service), { waitUntil:"domcontentloaded",timeout:25000 });
      const initial = await inspect(page);
      if (initial !== "SESSION_EXPIRED") throw fail(initial === "SESSION_VALID" ? "SCHOOL_LOGIN_FORM_CHANGED" : initial);
      const account = page.locator('#username'), password = page.locator('#password'), submit = page.locator('#login_submit');
      if (await account.count() !== 1 || await password.count() !== 1 || await submit.count() !== 1 || !await account.isVisible() || !await password.isVisible() || !await submit.isVisible()) throw fail("SCHOOL_LOGIN_FORM_CHANGED");
      const formAction = await submit.evaluate(el => el.form && el.form.action);
      if (!allowedUrl(formAction) || new URL(formAction).origin !== AUTH_ORIGIN) throw fail("SCHOOL_TLS_OR_ORIGIN_REJECTED");
      await account.fill(credentials.account);
      // Official CAS pre-login check. No password is sent when a challenge is required.
      const captcha = await context.request.get(AUTH_ORIGIN+"/authserver/checkNeedCaptcha.htl?username="+encodeURIComponent(credentials.account), { timeout:10000,maxRedirects:0 });
      if (!captcha.ok() || !allowedUrl(captcha.url())) throw fail("SCHOOL_LOGIN_FORM_CHANGED");
      let need; try { need = await captcha.json(); } catch (_) { throw fail("SCHOOL_LOGIN_FORM_CHANGED"); }
      if (!need || typeof need.isNeed !== "boolean") throw fail("SCHOOL_LOGIN_FORM_CHANGED");
      if (need.isNeed) throw fail("SCHOOL_SECURITY_CHALLENGE");
      if (await inspect(page) !== "SESSION_EXPIRED") throw fail("SCHOOL_SECURITY_CHALLENGE");
      await password.fill(credentials.password);
      await submit.click(); // Exactly one submission; no password retry.
      let status = "SESSION_EXPIRED";
      for (let i=0;i<20;i++) {
        await page.waitForTimeout(1000);
        status = await inspect(page);
        if (status !== "SESSION_EXPIRED") break;
      }
      if (status !== "SESSION_VALID") throw fail(status === "SESSION_EXPIRED" ? "SCHOOL_LOGIN_NOT_COMPLETED" : status);
      return context.storageState();
    },
    async close() { if (deps.signal) deps.signal.removeEventListener("abort",abort); await browser.close(); }
  };
}
async function checkSession(cfg, deps = {}) {
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
    throw fail(/^(INVALID_CREDENTIALS|SCHOOL_[A-Z_]+|COLLECTOR_STOPPED)$/.test(error.code || "") ? error.code : "SCHOOL_AUTH_TRANSPORT_FAILED");
  } finally { await adapter.close(); }
}
async function ensureSession(cfg, deps = {}) {
  const credentialsPath = cfg.schoolCredentialsPath || "/etc/fosuclass/school-auth.json";
  if (!fs.existsSync(credentialsPath)) return { status:"manual-session", schoolLoginAttempts:0 };
  const credentials = loadCredentials(credentialsPath, deps.platform);
  if (!credentials.recoveryEnabled && !deps.manualRecovery) return { status:"manual-session",schoolLoginAttempts:0 };
  const now = (deps.now || Date.now)();
  if (deps.approved !== true && !(credentials.recoveryEnabled && Date.parse(credentials.approvedUntil || "") > now)) throw fail("SCHOOL_AUTH_APPROVAL_REQUIRED");
  const statePath = path.join(cfg.dataRoot,"school-auth-state.json");
  let state = readJson(statePath, {});
  if (state.blocked) throw fail("SCHOOL_AUTH_MANUAL_ACTION_REQUIRED");
  if (state.cooldownUntil > now) throw fail("SCHOOL_AUTH_COOLDOWN");
  const adapter = await (deps.createAdapter || createAdapter)(cfg, deps);
  try {
    const status = await adapter.check(cfg.sessionPath);
    if (status === "SESSION_VALID") return { status,schoolLoginAttempts:0 };
    if (status !== "SESSION_EXPIRED") throw fail(status);
    if (state.windowStart && now-state.windowStart < DAY_MS && state.attempts >= 2) throw fail("SCHOOL_AUTH_DAILY_LIMIT");
    if (!state.windowStart || now-state.windowStart >= DAY_MS) state = { windowStart:now,attempts:0 };
    state.attempts++;
    state.cooldownUntil = now+COOLDOWN_MS;
    writeJsonAtomic(statePath,state); // A crash cannot erase the attempt/cooldown.
    const session = await adapter.login(credentials);
    if (deps.signal && deps.signal.aborted) throw fail("COLLECTOR_STOPPED");
    if (!session || !Array.isArray(session.cookies) || !Array.isArray(session.origins)) throw fail("SCHOOL_SESSION_INVALID");
    const candidate = cfg.sessionPath+".candidate";
    if (fs.existsSync(candidate)) throw fail("SCHOOL_SESSION_CANDIDATE_EXISTS");
    fs.writeFileSync(candidate,JSON.stringify(session),{ mode:0o600,flag:"wx" });
    try {
      if (await adapter.check(candidate) !== "SESSION_VALID") throw fail("SCHOOL_SESSION_INVALID");
      fs.renameSync(candidate,cfg.sessionPath);
    } finally { if (fs.existsSync(candidate)) fs.unlinkSync(candidate); }
    writeJsonAtomic(statePath,{ ...state,cooldownUntil:0,lastSuccessAt:now });
    return { status:"SESSION_RECOVERED",schoolLoginAttempts:1 };
  } catch (error) {
    // Only allowlisted codes persist; browser URLs/HTML/credentials never leave this module.
    const code = /^(INVALID_CREDENTIALS|SCHOOL_[A-Z_]+|COLLECTOR_STOPPED)$/.test(error.code || "") ? error.code : "SCHOOL_AUTH_TRANSPORT_FAILED";
    const blocked = /INVALID_CREDENTIALS|CHALLENGE|CHANGED|TLS|SESSION_INVALID/.test(code);
    writeJsonAtomic(statePath,{ ...state,cooldownUntil:now+COOLDOWN_MS,blocked,lastFailureCode:code });
    throw fail(code);
  } finally { await adapter.close(); }
}
module.exports = { COOLDOWN_MS,allowedUrl,checkSession,classifyPage,createAdapter,ensureSession,loadCredentials,secureFile };
