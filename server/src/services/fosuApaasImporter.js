const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const cheerio = require("cheerio");
const iconv = require("iconv-lite");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { encryptFosuPassword } = require("../utils/fosu-password-encrypt");
const { safeLog, maskStudentId } = require("../utils/safeLogger");
const { buildScheduleImportPreview } = require("./scheduleImportNormalizer");
const { getClassSchedule } = require("./scheduleService");

const axiosClient = wrapper(axios.default || axios);
const SCHEDULE_KEYWORDS = ["本科生学生课表", "学生课表", "课表"];
const REQUIRED_ROW_KEYS = ["学生姓名", "课程名称", "周次", "星期几", "节次", "课室名称", "上课班级", "校区", "特别说明"];

// Known links are only a last-resort fallback. APaaS app/source ids can change.
const FALLBACK_ENTRIES = [
  "/dashboard/app/42/form/22adbc6ad6b14909b15fd31a4b230c1d",
  "/m/dashboard/app/42/source/22adbc6ad6b14909b15fd31a4b230c1d",
];

const DEFAULT_BROWSER_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const APP_ENTRY_CACHE_TTL_MS = Math.max(60_000, Number(process.env.FOSU_APAAS_ENTRY_CACHE_TTL_MS || 12 * 60 * 60 * 1000) || 12 * 60 * 60 * 1000);
const appEntryCache = {
  entry: null,
  expiresAtMs: 0,
};

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function approxJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value == null ? null : value), "utf8");
  } catch (error) {
    return 0;
  }
}

function getApaasBase() {
  return String(config.FOSU_APAAS_BASE || "https://apaas.fosu.edu.cn").replace(/\/+$/g, "");
}

function getAuthBase() {
  return String(config.FOSU_AUTH_BASE || "https://authserver.fosu.edu.cn").replace(/\/+$/g, "");
}

function resolveUrl(value, base) {
  try {
    return new URL(String(value || ""), base || getApaasBase()).toString();
  } catch (error) {
    return "";
  }
}

function buildApaasCasServiceUrl(redirectPath = "/dashboard") {
  const apaasBase = getApaasBase();
  const service = new URL(`${apaasBase}/oauth/succ`);
  service.searchParams.set("redirect", redirectPath || "/dashboard");
  service.searchParams.set("authmode", "cas");
  return service.toString();
}

function buildCasLoginUrl(redirectPath = "/dashboard") {
  const authBase = getAuthBase();
  const login = new URL(`${authBase}/authserver/login`);
  login.searchParams.set("type", "userNameLogin");
  login.searchParams.set("service", buildApaasCasServiceUrl(redirectPath));
  return login.toString();
}

function buildCasLoginPostUrl(loginUrl) {
  const authBase = getAuthBase();
  const post = new URL(`${authBase}/authserver/login`);
  try {
    const service = new URL(loginUrl).searchParams.get("service");
    if (service) post.searchParams.set("service", service);
  } catch (error) {
    // Keep the base post URL if the login URL is malformed.
  }
  return post.toString();
}

function storeResponseCookies(jar, response) {
  if (!jar || !response || !response.headers) return;
  const rawCookies = response.headers["set-cookie"];
  const cookies = Array.isArray(rawCookies) ? rawCookies : (rawCookies ? [rawCookies] : []);
  if (!cookies.length) return;
  const responseUrl = response.config && response.config.url
    ? resolveUrl(response.config.url, response.config.baseURL || getApaasBase())
    : "";
  if (!responseUrl) return;
  cookies.forEach((cookie) => {
    try {
      jar.setCookieSync(cookie, responseUrl, { ignoreError: true });
    } catch (error) {
      // Cookie parsing failures are non-fatal; later auth verification will fail safely.
    }
  });
}

function createApaasClient(jar, options = {}) {
  const timeout = Number(config.FOSU_IMPORT_TIMEOUT_MS || process.env.FOSU_IMPORT_TIMEOUT_MS || 30000) || 30000;
  const instance = axiosClient.create({
    jar,
    timeout,
    withCredentials: true,
    responseType: "arraybuffer",
    maxRedirects: options.maxRedirects == null ? 5 : options.maxRedirects,
    validateStatus: options.validateStatus || ((status) => status >= 200 && status < 400),
    headers: {
      "User-Agent": config.FOSU_IMPORT_MOBILE_UA || process.env.FOSU_IMPORT_MOBILE_UA ||
        DEFAULT_BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    },
  });

  instance.interceptors.response.use((response) => {
    storeResponseCookies(jar, response);
    const contentType = response.headers["content-type"] || "";
    const isGbk = /gbk|gb2312/i.test(contentType);
    if (Buffer.isBuffer(response.data) || response.data instanceof ArrayBuffer) {
      const buffer = Buffer.from(response.data);
      response.data = isGbk ? iconv.decode(buffer, "gbk") : iconv.decode(buffer, "utf8");
    }
    return response;
  });
  return instance;
}

function isLoginPage(html, url) {
  const content = String(html || "");
  return /authserver\.fosu\.edu\.cn|\/authserver\/login/.test(String(url || "")) ||
    (/name=["']username["']/.test(content) && /name=["']password["']/.test(content));
}

function detectHumanVerification(html) {
  const content = String(html || "");
  const needCaptcha = content.match(/needCaptcha\s*=\s*["']?([^"';\s]+)/i);
  if (needCaptcha && /true|1|yes/i.test(needCaptcha[1])) return "CAPTCHA_REQUIRED";
  if (/riskControl|风险拦截|风控/i.test(content)) return "RISK_CONTROL_REQUIRED";
  const $ = cheerio.load(content);
  const errorText = $(".error, .error-tip, .login-error, #msg, .msg, .tips")
    .text()
    .replace(/\s+/g, " ");
  if (/验证码|captcha/i.test(errorText)) return "CAPTCHA_REQUIRED";
  if (/滑块|拼图|人机|验证失败|安全验证/i.test(errorText)) return "RISK_CONTROL_REQUIRED";
  return "";
}

function parseCasLoginForm(html) {
  const $ = cheerio.load(String(html || ""));
  const fields = {};

  const forms = $("form").toArray().map((form) => {
    const $form = $(form);
    const passwordInputs = $form.find("input[type='password'], input#password");
    const cllt = $form.find("input[name='cllt']").last().attr("value") || "";
    const id = $form.attr("id") || "";
    let score = 0;
    if (passwordInputs.length) score += 5;
    if (/pwd|password|loginFromId/i.test(id)) score += 2;
    if (cllt === "userNameLogin") score += 4;
    if ($form.find("input[name='password'], input#saltPassword").length) score += 2;
    if ($form.find("#pwdEncryptSalt").length) score += 2;
    return { form, score };
  }).sort((left, right) => right.score - left.score);

  const bestForm = forms.find((item) => item.score >= 5);
  const $root = bestForm ? $(bestForm.form) : $("body");
  $root.find("input").each((i, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    fields[name] = $(el).attr("value") || "";
  });
  fields.action = bestForm ? ($(bestForm.form).attr("action") || "") : "";
  fields.execution = fields.execution || $root.find("#execution").val() || $("#execution").val() || "";
  fields.lt = fields.lt || $root.find("#lt").val() || $("#lt").val() || "";
  fields.pwdEncryptSalt = fields.pwdEncryptSalt || $root.find("#pwdEncryptSalt").val() || $("#pwdEncryptSalt").val() || "";
  fields._eventId = fields._eventId || "submit";
  fields.cllt = "userNameLogin";
  fields.dllt = fields.dllt || "generalLogin";
  return fields;
}

function buildLoginPostData(fields, studentId, password) {
  const encryptedPassword = fields.pwdEncryptSalt
    ? encryptFosuPassword(password, fields.pwdEncryptSalt)
    : password;
  const postData = new URLSearchParams();
  Object.keys(fields || {}).forEach((key) => {
    if (!["username", "password", "captcha", "passwordText", "userPassword", "action", "pwdEncryptSalt", "rememberMe"].includes(key)) {
      postData.append(key, fields[key] == null ? "" : String(fields[key]));
    }
  });
  postData.set("username", studentId);
  postData.set("password", encryptedPassword);
  postData.set("captcha", "");
  postData.set("_eventId", fields._eventId || "submit");
  postData.set("cllt", fields.cllt || "userNameLogin");
  postData.set("dllt", fields.dllt || "generalLogin");
  if (fields.lt !== undefined) postData.set("lt", fields.lt || "");
  if (fields.execution) postData.set("execution", fields.execution);
  return postData.toString();
}

function classifyLoginFailure(html) {
  const verification = detectHumanVerification(html);
  if (verification) return verification;
  const text = cheerio.load(String(html || "")).text().replace(/\s+/g, " ");
  if (/密码错误|用户名或密码|账号或密码|认证失败|登录失败|不存在/.test(text)) {
    return "INVALID_CREDENTIALS";
  }
  return "INVALID_CREDENTIALS";
}

async function followRedirects(client, startUrl, maxSteps = 8) {
  let nextUrl = startUrl;
  let last = null;
  for (let step = 0; step < maxSteps && nextUrl; step += 1) {
    const response = await client.get(nextUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    last = response;
    const location = response.headers && response.headers.location;
    if (!location || ![301, 302, 303, 307, 308].includes(response.status)) {
      break;
    }
    nextUrl = resolveUrl(location, nextUrl);
  }
  return last;
}

function isApaasCasCallback(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === getApaasBase() &&
      /\/(?:m\/)?oauth\/succ$/.test(parsed.pathname) &&
      Boolean(parsed.searchParams.get("ticket"));
  } catch (error) {
    return false;
  }
}

async function authorizeApaasCasSession(client, callbackUrl) {
  const apaasBase = getApaasBase();
  const parsed = new URL(callbackUrl);
  const ticket = parsed.searchParams.get("ticket") || "";
  const redirect = parsed.searchParams.get("redirect") || "/dashboard";
  const authmode = parsed.searchParams.get("authmode") || "cas";
  if (!ticket) {
    const error = new Error("APAAS_AUTH_TICKET_MISSING");
    error.code = "APAAS_AUTH_TICKET_MISSING";
    throw error;
  }

  await client.get(callbackUrl, {
    headers: { Referer: buildCasLoginUrl(redirect) },
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const backurl = `${apaasBase}/m/oauth/succ?redirect=${encodeURIComponent(redirect)}&authmode=${encodeURIComponent(authmode)}&ticket=${encodeURIComponent(ticket)}`;
  const response = await client.post(`${apaasBase}/api/authorize`, JSON.stringify({
    redirect,
    authmode,
    ticket,
    backurl,
  }), {
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json, text/plain, */*",
      Referer: callbackUrl,
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (response.status >= 400) {
    const error = new Error("APAAS_AUTHORIZATION_FAILED");
    error.code = "APAAS_AUTHORIZATION_FAILED";
    throw error;
  }
  applyApaasAccessTokenFromResponse(client, response);
  return response;
}

async function verifyApaasSession(client) {
  const apaasBase = getApaasBase();
  const response = await client.post(`${apaasBase}/api/profile/userinfo`, "", {
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: `${apaasBase}/m/dashboard`,
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });
  if (response.status >= 400 || isLoginPage(response.data, response.config.url)) {
    const error = new Error("APAAS_SESSION_UNVERIFIED");
    error.code = "APAAS_SESSION_UNVERIFIED";
    throw error;
  }
  return response;
}

function unwrapApaasStorageValue(raw) {
  const value = String(raw || "");
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    return parsed && (parsed.value || parsed.data || parsed.token || "") || "";
  } catch (error) {
    return value;
  }
}

function looksLikeAccessToken(value) {
  const text = toText(value);
  return text.length >= 20 && !/\s|<|>/.test(text);
}

function findAccessToken(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (typeof value === "string") {
    return looksLikeAccessToken(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAccessToken(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    const preferredKeys = [
      "accessToken",
      "access_token",
      "token",
      "idToken",
      "Authorization",
      "authorization",
      "pro__Access-Token",
    ];
    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key) && looksLikeAccessToken(value[key])) {
        return toText(value[key]);
      }
    }
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (/token|authorization/i.test(key) && looksLikeAccessToken(child)) {
        return toText(child);
      }
      if (!child || typeof child !== "object") continue;
      const found = findAccessToken(child, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function applyApaasAccessTokenFromResponse(client, response) {
  const payload = parseJsonMaybe(response && response.data) || response && response.data || {};
  const token = findAccessToken(payload);
  if (!token) return "";
  client.defaults.headers.common.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  return token;
}

function loadPlaywrightChromium() {
  const candidates = [
    path.join(__dirname, "../../../tools/fosu-sync-client/node_modules/playwright"),
    "playwright",
    "playwright-core",
  ];
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);
      if (loaded && loaded.chromium) {
        return { chromium: loaded.chromium, devices: loaded.devices || {} };
      }
    } catch (error) {
      // Try the next optional runtime.
    }
  }
  return null;
}

function browserLaunchCandidates() {
  const executablePath = process.env.FOSU_IMPORT_BROWSER_EXECUTABLE_PATH || "";
  const base = {
    headless: String(process.env.FOSU_IMPORT_BROWSER_HEADLESS || "true") !== "false",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  };
  const candidates = [];
  if (executablePath && fs.existsSync(executablePath)) {
    candidates.push(Object.assign({}, base, { executablePath }));
  }
  candidates.push(base);
  if (process.platform === "win32") {
    candidates.push(Object.assign({}, base, { channel: "msedge" }));
    candidates.push(Object.assign({}, base, { channel: "chrome" }));
  }
  return candidates;
}

async function launchImportBrowser(chromium) {
  let lastError = null;
  for (const options of browserLaunchCandidates()) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("PLAYWRIGHT_LAUNCH_FAILED");
}

function copyBrowserCookiesToJar(storageState, jar) {
  (storageState.cookies || []).forEach((cookie) => {
    if (!/fosu\.edu\.cn$/i.test(cookie.domain || "")) return;
    const domain = String(cookie.domain || "").replace(/^\./, "");
    const cookiePath = cookie.path || "/";
    const parts = [
      `${cookie.name}=${cookie.value}`,
      `Domain=${domain}`,
      `Path=${cookiePath}`,
    ];
    if (cookie.httpOnly) parts.push("HttpOnly");
    if (cookie.secure) parts.push("Secure");
    try {
      jar.setCookieSync(parts.join("; "), `https://${domain}${cookiePath}`, { ignoreError: true });
    } catch (error) {
      // Cookie import failures are handled by session verification.
    }
  });
}

async function fillAndSubmitCasLogin(page, studentId, password) {
  return page.evaluate(({ studentId: innerStudentId, password: innerPassword }) => {
    function visible(el) {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }
    function setValue(el, value) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      if (descriptor && descriptor.set) descriptor.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const username = Array.from(document.querySelectorAll("input#username, input[name='username']")).find(visible);
    const passwordInput = Array.from(document.querySelectorAll("input#password, input[type='password']")).find(visible);
    const submit = Array.from(document.querySelectorAll("#login_submit")).find(visible);
    if (!username || !passwordInput || !submit) return false;
    setValue(username, innerStudentId);
    setValue(passwordInput, innerPassword);
    submit.click();
    return true;
  }, { studentId, password });
}

async function loginWithBrowserCas(studentId, password, startedAt) {
  const playwright = loadPlaywrightChromium();
  if (!playwright) {
    const error = new Error("PLAYWRIGHT_UNAVAILABLE");
    error.code = "PLAYWRIGHT_UNAVAILABLE";
    throw error;
  }

  const loginUrl = buildCasLoginUrl("/dashboard");
  const timeout = Number(process.env.FOSU_IMPORT_BROWSER_LOGIN_TIMEOUT_MS || config.FOSU_IMPORT_BROWSER_LOGIN_TIMEOUT_MS || 60000) || 60000;
  const browser = await launchImportBrowser(playwright.chromium);
  let localPassword = password;
  try {
    const device = playwright.devices && (playwright.devices["iPhone 13"] || playwright.devices["iPhone 12"]) || {};
    const context = await browser.newContext(Object.assign({}, device, {
      ignoreHTTPSErrors: true,
      userAgent: process.env.FOSU_IMPORT_MOBILE_UA || config.FOSU_IMPORT_MOBILE_UA || DEFAULT_BROWSER_UA,
      viewport: device.viewport || { width: 390, height: 844 },
      isMobile: device.isMobile !== undefined ? device.isMobile : true,
      hasTouch: device.hasTouch !== undefined ? device.hasTouch : true,
    }));
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: "networkidle", timeout });
    const submitted = await fillAndSubmitCasLogin(page, studentId, localPassword);
    if (!submitted) {
      const error = new Error("LOGIN_PAGE_CHANGED");
      error.code = "LOGIN_PAGE_CHANGED";
      throw error;
    }
    localPassword = "";

    await page.waitForURL(/apaas\.fosu\.edu\.cn\/(?:m\/)?dashboard/, { timeout }).catch(() => {});
    await page.waitForTimeout(2000);
    if (!/apaas\.fosu\.edu\.cn\/(?:m\/)?dashboard/.test(page.url())) {
      const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
      const verification = detectHumanVerification(text);
      const error = new Error(verification || classifyLoginFailure(text));
      error.code = verification || classifyLoginFailure(text);
      throw error;
    }

    const token = unwrapApaasStorageValue(await page.evaluate(() => localStorage.getItem("pro__Access-Token") || ""));
    if (!token) {
      const error = new Error("APAAS_TOKEN_MISSING");
      error.code = "APAAS_TOKEN_MISSING";
      throw error;
    }
    const storageState = await context.storageState();
    const jar = new CookieJar();
    copyBrowserCookiesToJar(storageState, jar);
    const client = createApaasClient(jar);
    client.defaults.headers.common.Authorization = `Bearer ${token}`;
    await verifyApaasSession(client);
    const dashboard = await client.get(`${getApaasBase()}/dashboard`, {
      validateStatus: (status) => status >= 200 && status < 400,
    });
    safeLog("fosu-apaas-login-success", {
      studentId: maskStudentId(studentId),
      method: "browser",
      elapsedMs: Date.now() - startedAt,
    });
    return {
      jar,
      client,
      dashboardHtml: dashboard.data,
      loggedIn: true,
      authMode: "browser",
      accessToken: token,
    };
  } finally {
    localPassword = "";
    await browser.close().catch(() => {});
  }
}

async function loginWithCasHttp(studentId, password, startedAt) {
  const jar = new CookieJar();
  const client = createApaasClient(jar, { maxRedirects: 0 });
  const apaasBase = getApaasBase();
  let localPassword = password;

  try {
    const loginUrl = buildCasLoginUrl("/dashboard");

    const loginPage = await client.get(loginUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const verification = detectHumanVerification(loginPage.data);
    if (verification) {
      const error = new Error(verification);
      error.code = verification;
      throw error;
    }

    const fields = parseCasLoginForm(loginPage.data);
    if (!fields.execution && !fields.lt && !fields.pwdEncryptSalt) {
      const error = new Error("LOGIN_PAGE_CHANGED");
      error.code = "LOGIN_PAGE_CHANGED";
      throw error;
    }

    const postBody = buildLoginPostData(fields, studentId, localPassword);
    const postUrl = buildCasLoginPostUrl(loginUrl);
    const loginPost = await client.post(postUrl, postBody, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: loginUrl,
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    if (loginPost.status === 200 && isLoginPage(loginPost.data, loginUrl)) {
      const code = classifyLoginFailure(loginPost.data);
      const error = new Error(code);
      error.code = code;
      throw error;
    }

    if (loginPost.headers.location) {
      const nextUrl = resolveUrl(loginPost.headers.location, loginUrl);
      if (isApaasCasCallback(nextUrl)) {
        await authorizeApaasCasSession(client, nextUrl);
      } else {
        await followRedirects(client, nextUrl);
      }
    }

    const verifiedClient = createApaasClient(jar);
    if (client.defaults.headers.common.Authorization) {
      verifiedClient.defaults.headers.common.Authorization = client.defaults.headers.common.Authorization;
    }
    await verifyApaasSession(verifiedClient);
    const dashboard = await verifiedClient.get(`${apaasBase}/dashboard`, {
      validateStatus: (status) => status >= 200 && status < 400,
    });
    if (isLoginPage(dashboard.data, dashboard.config.url)) {
      const error = new Error("INVALID_CREDENTIALS");
      error.code = "INVALID_CREDENTIALS";
      throw error;
    }

    safeLog("fosu-apaas-login-success", {
      studentId: maskStudentId(studentId),
      method: "http",
      elapsedMs: Date.now() - startedAt,
    });
    return {
      jar,
      client: verifiedClient,
      dashboardHtml: dashboard.data,
      loggedIn: true,
    };
  } finally {
    localPassword = null;
  }
}

function shouldUseBrowserLoginFallback(error) {
  const code = String(error && (error.code || error.message) || "");
  return /APAAS_SESSION_UNVERIFIED|APAAS_AUTHORIZATION_FAILED|APAAS_AUTH_TICKET_MISSING|PLAYWRIGHT_REQUIRED/i.test(code);
}

async function loginWithCas(studentId, password) {
  const startedAt = Date.now();
  safeLog("fosu-apaas-login-start", { studentId: maskStudentId(studentId) });
  try {
    return await loginWithCasHttp(studentId, password, startedAt);
  } catch (error) {
    if (String(process.env.FOSU_IMPORT_BROWSER_LOGIN || "true") !== "false" && shouldUseBrowserLoginFallback(error)) {
      safeLog("fosu-apaas-browser-login-fallback", { reason: error.code || error.message });
      return loginWithBrowserCas(studentId, password, startedAt);
    }
    throw error;
  }
}

async function fetchApaasDashboard(session) {
  const apaasBase = getApaasBase();
  const urls = [`${apaasBase}/dashboard`, `${apaasBase}/m/dashboard`, `${apaasBase}/`];
  for (const url of urls) {
    const response = await session.client.get(url, {
      validateStatus: (status) => status >= 200 && status < 400,
    });
    if (!isLoginPage(response.data, response.config.url)) {
      return response.data;
    }
  }
  const error = new Error("APAAS_DASHBOARD_UNAVAILABLE");
  error.code = "APAAS_DASHBOARD_UNAVAILABLE";
  throw error;
}

function matchScheduleText(text) {
  const value = toText(text).replace(/\s+/g, "");
  if (!value) return false;
  return SCHEDULE_KEYWORDS.some((keyword) => value.includes(keyword));
}

function parseEntryFromUrl(url) {
  const text = String(url || "");
  const pc = text.match(/\/dashboard\/app\/([^/]+)\/form\/([^/?#]+)/);
  if (pc) return { appId: pc[1], formId: pc[2], sourceId: "", mode: "pc" };
  const mobile = text.match(/\/m\/dashboard\/app\/([^/]+)\/source\/([^/?#]+)/);
  if (mobile) return { appId: mobile[1], sourceId: mobile[2], formId: "", mode: "mobile" };
  return { appId: "", formId: "", sourceId: "", mode: "" };
}

function findStudentScheduleAppInHtml(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const entries = [];
  $("a[href], area[href]").each((i, el) => {
    const href = $(el).attr("href");
    const text = $(el).text() || $(el).attr("title") || $(el).attr("aria-label") || "";
    if (!href || !matchScheduleText(text)) return;
    const url = resolveUrl(href, baseUrl || getApaasBase());
    if (!url) return;
    entries.push(Object.assign({
      url,
      title: toText(text),
      discoveredBy: "dashboard-link",
      fallback: false,
    }, parseEntryFromUrl(url)));
  });

  const scriptText = $("script").map((i, el) => $(el).html() || "").get().join("\n");
  const scheduleIndex = scriptText.indexOf("本科生学生课表");
  const urlPattern = /["']([^"']*\/(?:m\/)?dashboard\/app\/[^"']+)["']/g;
  let match = null;
  while ((match = urlPattern.exec(scriptText)) !== null) {
    const raw = match[1].replace(/\\\//g, "/");
    if (scheduleIndex >= 0 && Math.abs(match.index - scheduleIndex) > 5000) continue;
    const url = resolveUrl(raw, baseUrl || getApaasBase());
    if (!url) continue;
    entries.push(Object.assign({
      url,
      title: "本科生学生课表",
      discoveredBy: "dashboard-script",
      fallback: false,
    }, parseEntryFromUrl(url)));
  }

  const unique = [];
  const seen = new Set();
  entries.forEach((entry) => {
    if (!entry.url || seen.has(entry.url)) return;
    seen.add(entry.url);
    unique.push(entry);
  });
  return unique[0] || null;
}

function collectObjects(value, results = []) {
  if (!value) return results;
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, results));
    return results;
  }
  if (typeof value === "object") {
    results.push(value);
    Object.keys(value).forEach((key) => collectObjects(value[key], results));
  }
  return results;
}

function responseData(response) {
  const payload = parseJsonMaybe(response && response.data) || response && response.data || {};
  return payload && payload.data !== undefined ? payload.data : payload;
}

function buildEntryFromSource(appId, source, discoveredBy) {
  const apaasBase = getApaasBase();
  const sourceCode = toText(source && (source.code || source.sourceCode || source.formCode || source.resourceCode));
  const formId = toText(source && (source.id || source.formId || source.sourceId));
  const title = toText(source && (source.title || source.name || source.label)) || "本科生学生课表";
  const code = sourceCode || formId;
  if (!appId || !code) return null;
  return {
    url: `${apaasBase}/m/dashboard/app/${appId}/source/${code}`,
    title,
    appId: String(appId),
    formId,
    sourceId: formId,
    formCode: sourceCode,
    sourceCode,
    mode: "mobile",
    discoveredBy,
    fallback: false,
  };
}

async function findStudentScheduleAppFromApi(session) {
  const apaasBase = getApaasBase();
  const candidateAppIds = [];
  try {
    const preferences = await session.client.get(`${apaasBase}/api/dashboard/preferences`, {
      headers: { Accept: "application/json, text/plain, */*" },
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const data = responseData(preferences);
    collectObjects(data).forEach((item) => {
      if (!item || !matchScheduleText(item.name || item.title || item.label)) return;
      const appId = toText(item.id || item.appId);
      if (appId && !candidateAppIds.includes(appId)) candidateAppIds.push(appId);
    });
  } catch (error) {
    safeLog("fosu-apaas-preferences-discovery-failed", { code: error.code || error.message });
  }

  try {
    const favorite = await session.client.get(`${apaasBase}/api/dashboard/favorite`, {
      headers: { Accept: "application/json, text/plain, */*" },
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const data = responseData(favorite);
    collectObjects(data).forEach((item) => {
      if (!item || !matchScheduleText(item.name || item.title || item.label)) return;
      const appId = toText(item.appId || item.id);
      if (appId && !candidateAppIds.includes(appId)) candidateAppIds.push(appId);
    });
  } catch (error) {
    safeLog("fosu-apaas-favorite-discovery-failed", { code: error.code || error.message });
  }

  if (!candidateAppIds.includes("42")) candidateAppIds.push("42");
  for (const appId of candidateAppIds) {
    try {
      const menu = await session.client.post(`${apaasBase}/api/app/${appId}/menu`, "", {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json;charset=UTF-8",
          Referer: `${apaasBase}/m/dashboard/app/${appId}`,
        },
        validateStatus: (status) => status >= 200 && status < 500,
      });
      const data = responseData(menu);
      const source = collectObjects(data).find((item) => item && matchScheduleText(item.title || item.name || item.label));
      const entry = buildEntryFromSource(appId, source, "app-menu-api");
      if (entry) return entry;
    } catch (error) {
      safeLog("fosu-apaas-app-menu-discovery-failed", {
        appId,
        code: error.code || error.message,
      });
    }
  }
  return null;
}

function cloneAppEntry(entry) {
  return entry ? Object.assign({}, entry) : null;
}

function getCachedStudentScheduleApp() {
  if (appEntryCache.entry && appEntryCache.expiresAtMs > Date.now()) {
    return cloneAppEntry(appEntryCache.entry);
  }
  return null;
}

function setCachedStudentScheduleApp(entry) {
  if (!entry || entry.fallback) return;
  appEntryCache.entry = cloneAppEntry(entry);
  appEntryCache.expiresAtMs = Date.now() + APP_ENTRY_CACHE_TTL_MS;
}

async function findStudentScheduleApp(session) {
  const apaasBase = getApaasBase();
  const cached = getCachedStudentScheduleApp();
  if (cached) {
    safeLog("fosu-apaas-entry-cache-hit", {
      appId: cached.appId || "",
      discoveredBy: cached.discoveredBy || "",
    });
    return cached;
  }
  const apiEntry = await findStudentScheduleAppFromApi(session);
  if (apiEntry) {
    setCachedStudentScheduleApp(apiEntry);
    return apiEntry;
  }

  const dashboardHtml = session.dashboardHtml || await fetchApaasDashboard(session);
  const found = findStudentScheduleAppInHtml(dashboardHtml, apaasBase);
  if (found) {
    setCachedStudentScheduleApp(found);
    return found;
  }

  for (const path of ["/dashboard", "/m/dashboard"]) {
    const response = await session.client.get(`${apaasBase}${path}`, {
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const entry = findStudentScheduleAppInHtml(response.data, `${apaasBase}${path}`);
    if (entry) {
      setCachedStudentScheduleApp(entry);
      return entry;
    }
  }

  safeLog("fosu-apaas-entry-fallback", { reason: "dynamic-discovery-empty" });
  return Object.assign({
    url: `${apaasBase}${FALLBACK_ENTRIES[0]}`,
    title: "本科生学生课表",
    discoveredBy: "known-fallback",
    fallback: true,
  }, parseEntryFromUrl(FALLBACK_ENTRIES[0]));
}

function normalizeHeader(text) {
  return toText(text).replace(/\s+/g, "");
}

function looksLikeScheduleRow(row) {
  const keys = Object.keys(row || {});
  const score = REQUIRED_ROW_KEYS.filter((key) => keys.includes(key) && toText(row[key])).length;
  return score >= 4 || Boolean(row && (row["课程名称"] || row.courseName) && (row["周次"] || row.weekText || row["星期几"] || row.weekdayText));
}

function collectScheduleRowsFromJson(value, results = []) {
  if (!value) return results;
  if (Array.isArray(value)) {
    const objectItems = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    const rows = objectItems.filter(looksLikeScheduleRow);
    if (rows.length) {
      results.push(rows);
    }
    value.forEach((item) => collectScheduleRowsFromJson(item, results));
    return results;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach((key) => collectScheduleRowsFromJson(value[key], results));
  }
  return results;
}

function parseJsonMaybe(text) {
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function extractRowsFromEmbeddedJson(html) {
  const $ = cheerio.load(String(html || ""));
  const candidates = [];
  $("script[type='application/json'], script#__NEXT_DATA__").each((i, el) => {
    const parsed = parseJsonMaybe($(el).text());
    if (parsed) candidates.push(parsed);
  });
  const scriptText = $("script").map((i, el) => $(el).html() || "").get().join("\n");
  const assignmentPattern = /(?:window\.__INITIAL_STATE__|window\.__NUXT__|__INITIAL_STATE__)\s*=\s*({[\s\S]*?});/g;
  let match = null;
  while ((match = assignmentPattern.exec(scriptText)) !== null) {
    const parsed = parseJsonMaybe(match[1]);
    if (parsed) candidates.push(parsed);
  }

  const groups = [];
  candidates.forEach((candidate) => collectScheduleRowsFromJson(candidate, groups));
  return groups.sort((left, right) => right.length - left.length)[0] || [];
}

function extractRowsFromTables(html) {
  const $ = cheerio.load(String(html || ""));
  const groups = [];
  $("table").each((tableIndex, table) => {
    const rows = [];
    let headers = [];
    $(table).find("tr").each((rowIndex, tr) => {
      const cells = $(tr).find("th,td").map((i, cell) => normalizeHeader($(cell).text())).get();
      if (!cells.length) return;
      const headerHits = cells.filter((cell) => REQUIRED_ROW_KEYS.includes(cell)).length;
      if (headerHits >= 3) {
        headers = cells;
        return;
      }
      if (!headers.length || cells.length < 3) return;
      const row = {};
      headers.forEach((header, index) => {
        if (header) row[header] = cells[index] || "";
      });
      if (looksLikeScheduleRow(row)) rows.push(row);
    });
    if (rows.length) groups.push(rows);
  });
  return groups.sort((left, right) => right.length - left.length)[0] || [];
}

function discoverApiUrls(html, baseUrl) {
  const content = String(html || "").replace(/\\\//g, "/");
  const urls = [];
  const patterns = [
    /["'](\/api\/[^"']+)["']/g,
    /["']([^"']+\/api\/[^"']+)["']/g,
    /url\s*:\s*["']([^"']+)["']/g,
  ];
  patterns.forEach((pattern) => {
    let match = null;
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[1];
      if (/captcha|authserver|logout|upload|static|\.js|\.css/i.test(raw)) continue;
      const url = resolveUrl(raw, baseUrl || getApaasBase());
      if (url && !urls.includes(url)) urls.push(url);
    }
  });
  return urls.slice(0, 30);
}

function buildFallbackApiCandidates(entry) {
  const apaasBase = getApaasBase();
  const appId = entry.appId || "";
  const formOrSource = entry.formId || entry.sourceId || "";
  const sourceId = entry.sourceId || entry.formId || "";
  const paths = [
    `/api/dashboard/app/${appId}/form/${formOrSource}/data`,
    `/api/dashboard/app/${appId}/source/${sourceId}/data`,
    `/api/app/${appId}/form/${formOrSource}/data`,
    `/api/app/${appId}/source/${sourceId}/data`,
    `/api/form/${formOrSource}/data`,
    `/api/source/${sourceId}/data`,
  ];
  return paths
    .filter((path) => appId && formOrSource && !path.includes("//"))
    .map((path) => `${apaasBase}${path}`);
}

function extractPaginationInfo(payload, rows) {
  const source = payload && typeof payload === "object" ? payload : {};
  const total = Number(source.total || source.count || source.totalCount || source.data && source.data.total || 0) || 0;
  const page = Number(source.page || source.current || source.currentPage || source.data && (source.data.page || source.data.current) || 1) || 1;
  const pageSize = Number(source.pageSize || source.size || source.limit || source.data && (source.data.pageSize || source.data.size) || (rows && rows.length) || 20) || 20;
  return { total, page, pageSize };
}

async function runLimited(tasks, limit) {
  const results = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(limit || 3) || 3, tasks.length || 1));
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function fetchRowsFromJsonApiPage(session, url, page, pageSize) {
  const target = new URL(url);
  target.searchParams.set("page", String(page));
  target.searchParams.set("current", String(page));
  target.searchParams.set("pageSize", String(pageSize));
  target.searchParams.set("size", String(pageSize));
  const response = await session.client.get(target.toString(), {
    headers: { Accept: "application/json,text/plain,*/*" },
    validateStatus: (status) => status >= 200 && status < 500,
  });
  if (response.status >= 400) return { rows: [], info: { total: 0, page, pageSize } };
  const payload = parseJsonMaybe(response.data) || response.data;
  const groups = collectScheduleRowsFromJson(payload, []);
  const rows = groups.sort((left, right) => right.length - left.length)[0] || [];
  return {
    rows,
    info: extractPaginationInfo(payload, rows),
  };
}

async function fetchRowsFromJsonApiPageWithRetry(session, url, page, pageSize) {
  try {
    return await fetchRowsFromJsonApiPage(session, url, page, pageSize);
  } catch (error) {
    safeLog("fosu-apaas-json-page-retry", { page, code: error.code || error.message });
    return fetchRowsFromJsonApiPage(session, url, page, pageSize);
  }
}

async function fetchRowsFromJsonApi(session, url) {
  const allRows = [];
  const seenKeys = new Set();
  const requestedPageSize = Number(process.env.FOSU_APAAS_PAGE_SIZE || 200) || 200;
  const first = await fetchRowsFromJsonApiPage(session, url, 1, requestedPageSize);
  const addRows = (rows) => {
    rows.forEach((row) => {
      const key = JSON.stringify(row);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allRows.push(row);
      }
    });
  };
  addRows(first.rows || []);
  if (!first.rows || !first.rows.length) return allRows;

  const info = first.info || {};
  const total = Number(info.total || 0) || 0;
  const pageSize = Math.min(500, Math.max(20, Number(info.pageSize || requestedPageSize) || requestedPageSize));
  if (!total || allRows.length >= total) return allRows;

  const pageCount = Math.min(100, Math.ceil(total / pageSize));
  const tasks = [];
  for (let page = 2; page <= pageCount; page += 1) {
    tasks.push(() => fetchRowsFromJsonApiPageWithRetry(session, url, page, pageSize));
  }
  const pages = await runLimited(tasks, Number(process.env.FOSU_APAAS_PAGE_CONCURRENCY || 3) || 3);
  pages.forEach((pageResult) => addRows(pageResult && pageResult.rows || []));

  return allRows;
}

function normalizeApaasCellValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => normalizeApaasCellValue(item)).filter(Boolean).join(",");
  }
  if (typeof value === "object") {
    return toText(value.title || value.name || value.label || value.value || value.text || value.code || "");
  }
  return toText(value);
}

function collectFormColumns(value, results = []) {
  if (!value) return results;
  if (Array.isArray(value)) {
    value.forEach((item) => collectFormColumns(item, results));
    return results;
  }
  if (typeof value === "object") {
    const label = toText(value.title || value.label || value.name);
    const code = toText(value.code || value.id || value.field || value.model);
    if (label && code) {
      results.push({ label, code });
    }
    Object.keys(value).forEach((key) => collectFormColumns(value[key], results));
  }
  return results;
}

function mapApaasDataRows(rows, columns) {
  const mappedColumns = [];
  const seen = new Set();
  (columns || []).forEach((column) => {
    if (!column || !column.label || !column.code) return;
    const key = `${column.label}|${column.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    mappedColumns.push(column);
  });

  return (rows || []).map((row) => {
    const mapped = {};
    mappedColumns.forEach((column) => {
      const value = normalizeApaasCellValue(row[column.code]);
      if (!value) return;
      if (mapped[column.label]) return;
      mapped[column.label] = value;
    });
    if (row && row.id) mapped.__apaasRowId = toText(row.id);
    return mapped;
  }).filter((row) => toText(row["课程名称"]) || looksLikeScheduleRow(row));
}

async function fetchApaasFormDefinition(session, entry) {
  const apaasBase = getApaasBase();
  const appId = entry.appId || "42";
  const formCode = entry.formCode || entry.sourceCode || entry.formId || entry.sourceId;
  if (!appId || !formCode) return null;
  const response = await session.client.post(`${apaasBase}/api/app/${appId}/form/${formCode}`, "", {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      Referer: `${apaasBase}/m/dashboard/app/${appId}/source/${formCode}`,
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });
  if (response.status >= 400) return null;
  const data = responseData(response);
  return data && typeof data === "object" ? data : null;
}

function buildApaasDataQueryBody(entry, formDefinition, from, size) {
  const formId = toText(entry.formId || entry.sourceId || formDefinition && formDefinition.id);
  const formCode = toText(entry.formCode || entry.sourceCode || formDefinition && formDefinition.code);
  return {
    appId: toText(entry.appId || formDefinition && formDefinition.appId || "42"),
    formId,
    formCode,
    permissionGroupId: toText(entry.permissionGroupId || "1"),
    query: JSON.stringify({
      from,
      size,
      query: { bool: { must: [], must_not: [] } },
      sort: [{ createTime: { order: "desc" } }],
    }),
  };
}

async function fetchApaasDataQueryPage(session, entry, formDefinition, columns, from, size) {
  const apaasBase = getApaasBase();
  const body = buildApaasDataQueryBody(entry, formDefinition, from, size);
  if (!body.appId || !body.formId || !body.formCode) return { rows: [], total: 0 };
  const response = await session.client.post(`${apaasBase}/api/data/query`, JSON.stringify(body), {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      Referer: `${apaasBase}/m/dashboard/app/${body.appId}/source/${body.formCode}`,
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });
  if (response.status >= 400) return { rows: [], total: 0 };
  const data = responseData(response);
  const rows = data && Array.isArray(data.datas) ? data.datas : [];
  return {
    rows: mapApaasDataRows(rows, columns),
    rawCount: rows.length,
    total: Number(data && data.count || 0) || 0,
  };
}

async function fetchApaasDataQueryPageWithRetry(session, entry, formDefinition, columns, from, size) {
  try {
    return await fetchApaasDataQueryPage(session, entry, formDefinition, columns, from, size);
  } catch (error) {
    safeLog("fosu-apaas-data-query-page-retry", { from, code: error.code || error.message });
    return fetchApaasDataQueryPage(session, entry, formDefinition, columns, from, size);
  }
}

async function fetchRowsFromApaasDataQuery(session, entry) {
  if (!entry || !entry.appId || !(entry.formCode || entry.sourceCode || entry.formId || entry.sourceId)) {
    return [];
  }
  const apaasBase = getApaasBase();
  const formDefinition = await fetchApaasFormDefinition(session, entry);
  if (!formDefinition) return [];
  entry.formId = toText(entry.formId || formDefinition.id);
  entry.sourceId = toText(entry.sourceId || formDefinition.id);
  entry.formCode = toText(entry.formCode || formDefinition.code);
  entry.sourceCode = toText(entry.sourceCode || formDefinition.code);

  const columns = collectFormColumns(formDefinition.columns || formDefinition.formJson || formDefinition);
  const allRows = [];
  const seenKeys = new Set();
  const pageSize = Math.min(500, Math.max(20, Number(process.env.FOSU_APAAS_PAGE_SIZE || 200) || 200));
  const addRows = (rows) => {
    (rows || []).forEach((row) => {
      const key = JSON.stringify(row);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      allRows.push(row);
    });
  };

  const first = await fetchApaasDataQueryPage(session, entry, formDefinition, columns, 0, pageSize);
  addRows(first.rows);
  const total = Number(first.total || 0) || 0;
  if (total && first.rawCount && first.rawCount < total) {
    const tasks = [];
    for (let from = pageSize; from < Math.min(10000, total); from += pageSize) {
      tasks.push(() => fetchApaasDataQueryPageWithRetry(session, entry, formDefinition, columns, from, pageSize));
    }
    const pages = await runLimited(tasks, Number(process.env.FOSU_APAAS_PAGE_CONCURRENCY || 3) || 3);
    pages.forEach((pageResult) => addRows(pageResult && pageResult.rows || []));
  } else if (!total && first.rawCount === pageSize) {
    for (let from = pageSize; from < 10000; from += pageSize) {
      const page = await fetchApaasDataQueryPageWithRetry(session, entry, formDefinition, columns, from, pageSize);
      if (!page.rawCount) break;
      addRows(page.rows);
      if (page.rawCount < pageSize) break;
    }
  }

  if (allRows.length) {
    safeLog("fosu-apaas-data-query-detected", {
      rowCount: allRows.length,
      appId: entry.appId,
    });
  }
  return allRows;
}

function discoverPaginationUrls(html, pageUrl) {
  const $ = cheerio.load(String(html || ""));
  const urls = [];
  $("a[href]").each((i, el) => {
    const text = toText($(el).text());
    const href = $(el).attr("href");
    if (!href) return;
    if (/下一页|末页|^\d+$/.test(text) || /page|current|分页/.test(href)) {
      const url = resolveUrl(href, pageUrl);
      if (url && !urls.includes(url)) urls.push(url);
    }
  });
  return urls.slice(0, 50);
}

async function fetchScheduleRows(session, appEntry) {
  const entryUrl = appEntry && appEntry.url;
  if (!entryUrl) {
    const error = new Error("APAAS_STRUCTURE_CHANGED");
    error.code = "APAAS_STRUCTURE_CHANGED";
    throw error;
  }

  const dataQueryRows = await fetchRowsFromApaasDataQuery(session, appEntry);
  if (dataQueryRows.length) return dataQueryRows;

  const page = await session.client.get(entryUrl, {
    validateStatus: (status) => status >= 200 && status < 400,
  });
  if (isLoginPage(page.data, page.config.url)) {
    const error = new Error("APAAS_SESSION_EXPIRED");
    error.code = "APAAS_SESSION_EXPIRED";
    throw error;
  }

  const embeddedRows = extractRowsFromEmbeddedJson(page.data);
  if (embeddedRows.length) return embeddedRows;

  const apiUrls = discoverApiUrls(page.data, entryUrl).concat(buildFallbackApiCandidates(appEntry));
  for (const apiUrl of apiUrls) {
    try {
      const rows = await fetchRowsFromJsonApi(session, apiUrl);
      if (rows.length) {
        safeLog("fosu-apaas-json-api-detected", {
          rowCount: rows.length,
          apiPath: new URL(apiUrl).pathname,
        });
        return rows;
      }
    } catch (error) {
      safeLog("fosu-apaas-json-api-candidate-failed", {
        apiPath: (() => { try { return new URL(apiUrl).pathname; } catch (e) { return ""; } })(),
        code: error.code || error.message,
      });
    }
  }

  const tableRows = extractRowsFromTables(page.data);
  const paginationUrls = discoverPaginationUrls(page.data, entryUrl);
  const seenPageUrls = new Set([entryUrl]);
  for (const paginationUrl of paginationUrls) {
    if (seenPageUrls.has(paginationUrl)) continue;
    seenPageUrls.add(paginationUrl);
    try {
      const response = await session.client.get(paginationUrl, {
        validateStatus: (status) => status >= 200 && status < 400,
      });
      extractRowsFromTables(response.data).forEach((row) => tableRows.push(row));
    } catch (error) {
      safeLog("fosu-apaas-pagination-fetch-failed", { code: error.code || error.message });
    }
  }
  if (tableRows.length) return tableRows;

  const error = new Error("APAAS_STRUCTURE_CHANGED");
  error.code = "APAAS_STRUCTURE_CHANGED";
  throw error;
}

function normalizeRowsForPreview(rawRows, options = {}) {
  return buildScheduleImportPreview(rawRows, options);
}

async function loadLocalClassCourses(targetClassName, semester) {
  const className = toText(targetClassName);
  if (!className) return [];
  try {
    const result = await getClassSchedule({ semester, className });
    if (result && result.success && Array.isArray(result.classes) && result.classes[0]) {
      return Array.isArray(result.classes[0].courses) ? result.classes[0].courses : [];
    }
  } catch (error) {
    safeLog("fosu-apaas-local-class-match-failed", {
      className,
      code: error.code || error.message,
    });
  }
  return [];
}

function destroySession(session) {
  if (!session) return;
  session.client = null;
  session.jar = null;
  session.dashboardHtml = null;
}

function normalizeImportChannelStrategy(value) {
  const strategy = String(value || config.FOSU_IMPORT_CHANNEL || config.FOSU_IMPORT_CHANNEL_STRATEGY || "auto").trim().toLowerCase();
  if (strategy === "cloudbase" || strategy === "oracle" || strategy === "auto") return strategy;
  return "auto";
}

function boolConfig(value, defaultValue = false) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return defaultValue;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return defaultValue;
}

function cloudbaseImportEnabled() {
  return boolConfig(config.FOSU_CLOUDBASE_IMPORT_ENABLE, false);
}

function getCloudbaseRelayUrl() {
  return String(config.FOSU_CLOUDBASE_IMPORT_URL || config.FOSU_IMPORT_CLOUDBASE_RELAY_URL || "").trim();
}

function cloudbaseRelayConfigured() {
  return cloudbaseImportEnabled() && Boolean(getCloudbaseRelayUrl());
}

function oracleFallbackEnabled() {
  return boolConfig(config.FOSU_IMPORT_ORACLE_FALLBACK, true);
}

function resolveImportChannels(strategyValue) {
  const strategy = normalizeImportChannelStrategy(strategyValue);
  const cloudbaseReady = cloudbaseRelayConfigured();
  const fallbackEnabled = oracleFallbackEnabled();
  if (strategy === "oracle") {
    return { strategy, channels: ["oracle"], reason: "forced_oracle" };
  }
  if (strategy === "cloudbase") {
    if (!cloudbaseReady && fallbackEnabled) {
      return {
        strategy,
        channels: ["oracle"],
        reason: "cloudbase_not_configured_oracle_fallback",
      };
    }
    return {
      strategy,
      channels: ["cloudbase"],
      reason: cloudbaseReady ? "forced_cloudbase" : "cloudbase_not_configured",
    };
  }
  if (cloudbaseReady) {
    return {
      strategy,
      channels: fallbackEnabled ? ["cloudbase", "oracle"] : ["cloudbase"],
      reason: fallbackEnabled ? "cloudbase_first_with_oracle_fallback" : "cloudbase_first_no_fallback",
    };
  }
  return { strategy, channels: ["oracle"], reason: "cloudbase_not_configured" };
}

function importChannelError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function sanitizeCloudbaseRelayErrorMessage(message) {
  const raw = toText(message);
  if (!raw || /<!doctype|<html|<body|<\/html>/i.test(raw)) {
    return "CloudBase import relay failed";
  }
  const scrubbed = raw
    .replace(/(password|passwd|pwd|cookie|ticket|token|authorization|session)\s*[:=]\s*[^,\s;&]+/ig, "$1=[REDACTED]")
    .replace(/JSESSIONID=[^;\s]+/ig, "JSESSIONID=[REDACTED]")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!scrubbed || scrubbed.length > 300) {
    return "CloudBase import relay failed";
  }
  return scrubbed.slice(0, 180);
}

function normalizeCloudbaseRelayCode(code, status) {
  const raw = String(code || "").trim().toUpperCase();
  if (status === 408 || status === 504) return "UPSTREAM_TIMEOUT";
  if (status >= 500) return "CLOUDBASE_SERVICE_UNAVAILABLE";
  if (!raw) return "CLOUDBASE_IMPORT_FAILED";
  if (/ETIMEDOUT|ECONNABORTED|ESOCKETTIMEDOUT|TIMEOUT/.test(raw)) return "NETWORK_TIMEOUT";
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_NETWORK|SOCKET/.test(raw)) return "NETWORK_TIMEOUT";
  const known = new Set([
    "INVALID_CREDENTIALS",
    "CAPTCHA_REQUIRED",
    "RISK_CONTROL_REQUIRED",
    "ACCOUNT_LOCKED",
    "SCHOOL_SYSTEM_REJECTED",
    "SCHOOL_SYSTEM_TIMEOUT",
    "NETWORK_TIMEOUT",
    "UPSTREAM_TIMEOUT",
    "LOGIN_PAGE_CHANGED",
    "APAAS_STRUCTURE_CHANGED",
    "APAAS_DASHBOARD_UNAVAILABLE",
    "SCHEDULE_APP_NOT_FOUND",
    "SCHEDULE_EMPTY",
    "SCHEDULE_ROWS_EMPTY",
    "CLOUDBASE_IMPORT_NOT_CONFIGURED",
    "CLOUDBASE_SERVICE_UNAVAILABLE",
    "CLOUDBASE_IMPORT_FAILED",
    "APAAS_SESSION_UNVERIFIED",
  ]);
  return known.has(raw) ? raw : "CLOUDBASE_IMPORT_FAILED";
}

function stripSensitiveAxiosError(error) {
  if (!error || !error.config) return error;
  if (error.config.data) error.config.data = "[REDACTED]";
  if (error.config.headers) {
    if (error.config.headers.Authorization) error.config.headers.Authorization = "[REDACTED]";
    if (error.config.headers.authorization) error.config.headers.authorization = "[REDACTED]";
    if (error.config.headers.Cookie) error.config.headers.Cookie = "[REDACTED]";
    if (error.config.headers.cookie) error.config.headers.cookie = "[REDACTED]";
  }
  return error;
}

function isTimeoutLikeError(error) {
  const code = String(error && (error.code || error.message) || "");
  return /ETIMEDOUT|ECONNABORTED|ESOCKETTIMEDOUT|TIMEOUT|NETWORK_TIMEOUT|SCHOOL_SYSTEM_TIMEOUT|UPSTREAM_TIMEOUT/i.test(code);
}

function isConnectionFailureError(error) {
  const code = String(error && (error.code || error.message) || "");
  return /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_NETWORK|SOCKET HANG UP/i.test(code);
}

function normalizeChannelError(error, channel) {
  if (!error) return importChannelError("UNKNOWN_IMPORT_ERROR");
  const code = String(error && (error.code || error.message) || "");
  const status = Number(error && error.response && error.response.status || 0);
  if (channel === "cloudbase" && status >= 500) {
    error.code = status === 504 ? "UPSTREAM_TIMEOUT" : "CLOUDBASE_SERVICE_UNAVAILABLE";
  } else if (status === 408 || status === 504) {
    error.code = channel === "cloudbase" ? "UPSTREAM_TIMEOUT" : "SCHOOL_SYSTEM_TIMEOUT";
  } else if (/UPSTREAM_TIMEOUT/i.test(code)) {
    error.code = "UPSTREAM_TIMEOUT";
  } else if (/SCHOOL_SYSTEM_TIMEOUT/i.test(code)) {
    error.code = "SCHOOL_SYSTEM_TIMEOUT";
  } else if (/NETWORK_TIMEOUT/i.test(code)) {
    error.code = "NETWORK_TIMEOUT";
  } else if (isTimeoutLikeError(error)) {
    error.code = channel === "cloudbase" ? "NETWORK_TIMEOUT" : "SCHOOL_SYSTEM_TIMEOUT";
  } else if (isConnectionFailureError(error)) {
    error.code = "NETWORK_TIMEOUT";
  }
  return error;
}

function shouldFallbackToOracle(error) {
  const code = String(error && (error.code || error.message) || "");
  if (!oracleFallbackEnabled()) return false;
  return [
    "NETWORK_TIMEOUT",
    "SCHOOL_SYSTEM_TIMEOUT",
    "UPSTREAM_TIMEOUT",
    "CLOUDBASE_SERVICE_UNAVAILABLE",
    "CLOUDBASE_IMPORT_FAILED",
    "APAAS_SESSION_UNVERIFIED",
  ].includes(code);
}

function shouldRetryCloudbaseChannel(error) {
  const code = String(error && (error.code || error.message) || "");
  const retryable = [
    "NETWORK_TIMEOUT",
    "SCHOOL_SYSTEM_TIMEOUT",
    "UPSTREAM_TIMEOUT",
    "CLOUDBASE_SERVICE_UNAVAILABLE",
    "CLOUDBASE_IMPORT_FAILED",
    "APAAS_SESSION_UNVERIFIED",
  ].includes(code);
  if (!retryable) return false;
  const elapsedMs = Number(error && error.elapsedMs || 0);
  const channelTimeout = Math.max(5000, Number(config.FOSU_IMPORT_CHANNEL_TIMEOUT_MS || config.FOSU_IMPORT_CLOUDBASE_TIMEOUT_MS || 25000) || 25000);
  const quickRetryWindowMs = Math.min(22000, Math.max(8000, Math.floor(channelTimeout * 0.9)));
  return !elapsedMs || elapsedMs <= quickRetryWindowMs;
}

async function fetchRowsViaOracleImporter(studentId, password, timing) {
  let session = null;
  const startedAt = Date.now();
  try {
    const loginStartedAt = Date.now();
    session = await loginWithCas(studentId, password);
    timing.loginMs = Date.now() - loginStartedAt;
    const discoverStartedAt = Date.now();
    const entry = await findStudentScheduleApp(session);
    timing.discoverMs = Date.now() - discoverStartedAt;
    timing.discoverAppMs = timing.discoverMs;
    const fetchStartedAt = Date.now();
    const rawRows = await fetchScheduleRows(session, entry);
    timing.fetchRowsMs = Date.now() - fetchStartedAt;
    if (!rawRows.length) {
      const error = new Error("SCHEDULE_EMPTY");
      error.code = "SCHEDULE_EMPTY";
      throw error;
    }
    return { rawRows, entry, channel: "oracle" };
  } catch (error) {
    throw normalizeChannelError(error, "oracle");
  } finally {
    destroySession(session);
    timing.totalReadMs = timing.totalReadMs || (Date.now() - startedAt);
  }
}

async function fetchRowsViaCloudbaseRelay(studentId, password, options, timing) {
  const relayUrl = getCloudbaseRelayUrl();
  if (!cloudbaseImportEnabled() || !relayUrl) {
    throw importChannelError("CLOUDBASE_IMPORT_NOT_CONFIGURED");
  }
  const timeout = Math.max(5000, Number(config.FOSU_IMPORT_CHANNEL_TIMEOUT_MS || config.FOSU_IMPORT_CLOUDBASE_TIMEOUT_MS || 25000) || 25000);
  const startedAt = Date.now();
  let localPassword = password;
  try {
    const response = await axiosClient.post(relayUrl, {
      studentId,
      password: localPassword,
      semester: options.semester || options.term || "",
      selectedClassName: options.existingSelectedClassName || options.selectedClassName || "",
    }, {
      timeout,
      headers: Object.assign({
        "Content-Type": "application/json",
        Accept: "application/json",
      }, config.FOSU_IMPORT_CLOUDBASE_RELAY_TOKEN ? {
        Authorization: `Bearer ${config.FOSU_IMPORT_CLOUDBASE_RELAY_TOKEN}`,
        "X-Fosu-Relay-Token": config.FOSU_IMPORT_CLOUDBASE_RELAY_TOKEN,
      } : {}),
      validateStatus: (status) => status >= 200 && status < 500,
    });
    localPassword = "";
    const payload = parseJsonMaybe(response.data) || response.data || {};
    if (response.status >= 400 || payload.success === false) {
      throw importChannelError(
        normalizeCloudbaseRelayCode(payload.code, response.status),
        sanitizeCloudbaseRelayErrorMessage(payload.message || payload.error || "")
      );
    }
    const rawRows = payload.rawRows || payload.rows || payload.scheduleRows || payload.data && (payload.data.rawRows || payload.data.rows);
    if (!Array.isArray(rawRows) || !rawRows.length) {
      throw importChannelError("SCHEDULE_EMPTY");
    }
    const relayTiming = payload.timing || payload.metrics || {};
    timing.loginMs = Number(relayTiming.loginMs || relayTiming.authMs || 0) || 0;
    timing.discoverMs = Number(relayTiming.discoverMs || relayTiming.discoverAppMs || 0) || 0;
    timing.discoverAppMs = timing.discoverMs;
    timing.fetchRowsMs = Number(relayTiming.fetchRowsMs || relayTiming.readRowsMs || 0) || (Date.now() - startedAt);
    timing.relayMs = Date.now() - startedAt;
    timing.rowsCount = Number(relayTiming.rowsCount || relayTiming.rowCount || rawRows.length) || rawRows.length;
    timing.bytesApprox = Number(relayTiming.bytesApprox || 0) || approxJsonBytes(rawRows);
    timing.hitCache = Boolean(relayTiming.hitCache);
    return {
      rawRows,
      entry: payload.appEntry || payload.entry || { channel: "cloudbase" },
      channel: "cloudbase",
    };
  } catch (error) {
    error.elapsedMs = error.elapsedMs || (Date.now() - startedAt);
    throw normalizeChannelError(stripSensitiveAxiosError(error), "cloudbase");
  } finally {
    localPassword = "";
  }
}

async function buildPreviewFromRawRows(studentId, rawRows, options, entry, timing, channel, startedAt) {
  const semester = options.semester || "\u5f53\u524d\u5b66\u671f";
  const importedAt = options.importedAt || new Date().toISOString();
  const selectedClassName = options.existingSelectedClassName || options.selectedClassName || "";
  const normalizeStartedAt = Date.now();
  const preliminary = normalizeRowsForPreview(rawRows, {
    studentId,
    semester,
    importedAt,
    appEntry: entry,
    existingSelectedClassName: selectedClassName,
    timing,
  });
  timing.normalizeMs = Date.now() - normalizeStartedAt;
  const matchStartedAt = Date.now();
  const localCourses = await loadLocalClassCourses(preliminary.profile && preliminary.profile.targetClassName, semester);
  timing.matchLocalScheduleMs = Date.now() - matchStartedAt;

  const finalNormalizeStartedAt = Date.now();
  const preview = normalizeRowsForPreview(rawRows, {
    studentId,
    semester,
    importedAt,
    appEntry: entry,
    existingSelectedClassName: selectedClassName,
    localCourses,
    timing,
  });
  timing.normalizeMs += Date.now() - finalNormalizeStartedAt;
  timing.totalMs = Date.now() - startedAt;
  timing.channel = channel;
  timing.rowsCount = timing.rowsCount || rawRows.length;
  timing.bytesApprox = timing.bytesApprox || approxJsonBytes(rawRows);
  preview.timing = timing;
  preview.importDiagnostics = {
    channel,
    fallbackReason: timing.fallbackReason || "",
    hitCache: Boolean(timing.hitCache),
    retryCount: timing.retryCount || 0,
    relayMs: timing.relayMs || 0,
    rowsCount: timing.rowsCount || rawRows.length,
    bytesApprox: timing.bytesApprox || approxJsonBytes(rawRows),
    loginMs: timing.loginMs || 0,
    discoverMs: timing.discoverMs || 0,
    fetchRowsMs: timing.fetchRowsMs || 0,
    normalizeMs: timing.normalizeMs || 0,
    totalMs: timing.totalMs || 0,
  };
  safeLog("fosu-apaas-preview-timing", {
    studentId: maskStudentId(studentId),
    channel,
    fallbackReason: timing.fallbackReason || "",
    hitCache: Boolean(timing.hitCache),
    retryCount: timing.retryCount || 0,
    rawRowCount: rawRows.length,
    rowsCount: timing.rowsCount || rawRows.length,
    bytesApprox: timing.bytesApprox || approxJsonBytes(rawRows),
    localCourseCount: localCourses.length,
    loginMs: timing.loginMs,
    discoverMs: timing.discoverMs,
    discoverAppMs: timing.discoverAppMs,
    fetchRowsMs: timing.fetchRowsMs,
    relayMs: timing.relayMs,
    normalizeMs: timing.normalizeMs,
    matchLocalScheduleMs: timing.matchLocalScheduleMs,
    totalMs: timing.totalMs,
  });
  return preview;
}

async function importSchedulePreviewWithChannel(channel, studentId, password, options, startedAt) {
  const timing = {
    channel,
    fallbackReason: options.fallbackReason || "",
    retryCount: Number(options.retryCount || 0) || 0,
  };
  const readResult = channel === "cloudbase"
    ? await fetchRowsViaCloudbaseRelay(studentId, password, options, timing)
    : await fetchRowsViaOracleImporter(studentId, password, timing);
  return buildPreviewFromRawRows(
    studentId,
    readResult.rawRows,
    options,
    readResult.entry,
    timing,
    readResult.channel || channel,
    startedAt
  );
}

async function importSchedulePreview(studentId, password, options = {}) {
  const startedAt = Date.now();
  const plan = resolveImportChannels(options.channelStrategy);
  const channels = plan.channels;
  safeLog("fosu-apaas-import-channel-plan", {
    studentId: maskStudentId(studentId),
    strategy: plan.strategy,
    channel: channels[0] || "",
    channels: channels.join(","),
    reason: plan.reason,
  });
  let lastError = null;
  let fallbackReason = "";
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    const maxAttempts = channel === "cloudbase" ? 2 : 1;
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      try {
        safeLog("fosu-apaas-import-channel-start", {
          studentId: maskStudentId(studentId),
          channel,
          retryCount: attemptIndex,
        });
        const preview = await importSchedulePreviewWithChannel(
          channel,
          studentId,
          password,
          Object.assign({}, options, {
            retryCount: attemptIndex,
            fallbackReason,
          }),
          startedAt
        );
        preview.channel = channel;
        return preview;
      } catch (error) {
        lastError = normalizeChannelError(error, channel);
        safeLog("fosu-apaas-import-channel-failed", {
          studentId: maskStudentId(studentId),
          channel,
          code: lastError.code || lastError.message,
          retryCount: attemptIndex,
        });
        if (channel === "cloudbase" && attemptIndex + 1 < maxAttempts && shouldRetryCloudbaseChannel(lastError)) {
          safeLog("fosu-apaas-import-channel-retry", {
            studentId: maskStudentId(studentId),
            channel,
            code: lastError.code || lastError.message,
            retryCount: attemptIndex + 1,
          });
          continue;
        }
        if (channel === "cloudbase" && channels.includes("oracle") && shouldFallbackToOracle(lastError)) {
          fallbackReason = lastError.code || lastError.message || "cloudbase_failed";
          safeLog("fosu-apaas-import-channel-fallback", {
            studentId: maskStudentId(studentId),
            from: "cloudbase",
            to: "oracle",
            reason: fallbackReason,
          });
          break;
        }
        throw lastError;
      }
    }
  }
  throw lastError || importChannelError("UNKNOWN_IMPORT_ERROR");
}

module.exports = {
  buildImportPreview: normalizeRowsForPreview,
  createApaasClient,
  destroySession,
  fetchApaasDashboard,
  fetchScheduleRows,
  findStudentScheduleApp,
  findStudentScheduleAppInHtml,
  importSchedulePreview,
  loginWithCas,
  normalizeChannelError,
  normalizeImportChannelStrategy,
  parseCasLoginForm,
  parseEntryFromUrl,
  resolveImportChannels,
  sanitizeCloudbaseRelayErrorMessage,
  shouldRetryCloudbaseChannel,
  shouldFallbackToOracle,
};
