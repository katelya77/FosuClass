const http = require("http");
const crypto = require("crypto");
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const cheerio = require("cheerio");
const iconv = require("iconv-lite");

const axiosClient = wrapper(axios.default || axios);
const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
const SCHEDULE_KEYWORDS = ["本科生学生课表", "学生课表", "课表"];
const REQUIRED_ROW_KEYS = ["学生姓名", "课程名称", "周次", "星期几", "节次", "课室名称", "上课班级", "校区", "特别说明"];
const FALLBACK_ENTRIES = [
  "/dashboard/app/42/form/22adbc6ad6b14909b15fd31a4b230c1d",
  "/m/dashboard/app/42/source/22adbc6ad6b14909b15fd31a4b230c1d",
];
const DEFAULT_BROWSER_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49";
const APP_ENTRY_CACHE_TTL_MS = Math.max(60000, Number(process.env.FOSU_APAAS_ENTRY_CACHE_TTL_MS || 12 * 60 * 60 * 1000) || 12 * 60 * 60 * 1000);
const appEntryCache = { entry: null, expiresAtMs: 0 };

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function maskStudentId(studentId) {
  const value = toText(studentId);
  if (!value) return "";
  if (value.length <= 8) return value.length <= 4 ? "****" : `${value.slice(0, 2)}****${value.slice(-2)}`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const output = {};
    Object.keys(value).forEach((key) => {
      const safeMetadataKey = /(Prefix|Masked|Configured|Kid|Mode|Status|Ms|Count|Code)$/i.test(key);
      output[key] = /(password|passwd|pwd|cookie|token|session|jsessionid|authorization|ticket|execution|captcha)/i.test(key) && !safeMetadataKey
        ? "[REDACTED]"
        : redactSecrets(value[key]);
    });
    return output;
  }
  if (typeof value === "string") {
    return value
      .replace(/(JSESSIONID=)[^;\s]+/gi, "$1[REDACTED]")
      .replace(/(ticket=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/(password|passwd|pwd|token|authorization|execution|captcha)=([^&\s]+)/gi, "$1=[REDACTED]");
  }
  return value;
}

function safeLog(label, payload) {
  console.log(`[${new Date().toISOString()}] [${label}]`, JSON.stringify(redactSecrets(payload || {})));
}

function randomString(length) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += AES_CHARS.charAt(crypto.randomInt(0, AES_CHARS.length));
  }
  return result;
}

function encryptFosuPassword(rawPassword, pwdEncryptSalt) {
  if (!pwdEncryptSalt) {
    const error = new Error("LOGIN_PAGE_CHANGED");
    error.code = "LOGIN_PAGE_CHANGED";
    throw error;
  }
  const plaintext = randomString(64) + rawPassword;
  const key = Buffer.from(pwdEncryptSalt, "utf8");
  const iv = Buffer.from(randomString(16), "utf8");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

function getApaasBase() {
  return String(process.env.FOSU_APAAS_BASE || "https://apaas.fosu.edu.cn").replace(/\/+$/g, "");
}

function getAuthBase() {
  return String(process.env.FOSU_AUTH_BASE || "https://authserver.fosu.edu.cn").replace(/\/+$/g, "");
}

function resolveUrl(value, base) {
  try {
    return new URL(String(value || ""), base || getApaasBase()).toString();
  } catch (error) {
    return "";
  }
}

function buildApaasCasServiceUrl(redirectPath = "/dashboard") {
  const service = new URL(`${getApaasBase()}/oauth/succ`);
  service.searchParams.set("redirect", redirectPath || "/dashboard");
  service.searchParams.set("authmode", "cas");
  return service.toString();
}

function buildCasLoginUrl(redirectPath = "/dashboard") {
  const login = new URL(`${getAuthBase()}/authserver/login`);
  login.searchParams.set("type", "userNameLogin");
  login.searchParams.set("service", buildApaasCasServiceUrl(redirectPath));
  return login.toString();
}

function buildCasLoginPostUrl(loginUrl) {
  const post = new URL(`${getAuthBase()}/authserver/login`);
  try {
    const service = new URL(loginUrl).searchParams.get("service");
    if (service) post.searchParams.set("service", service);
  } catch (error) {
    return post.toString();
  }
  return post.toString();
}

function storeResponseCookies(jar, response) {
  if (!jar || !response || !response.headers) return;
  const rawCookies = response.headers["set-cookie"];
  const cookies = Array.isArray(rawCookies) ? rawCookies : (rawCookies ? [rawCookies] : []);
  const responseUrl = response.config && response.config.url ? resolveUrl(response.config.url, response.config.baseURL || getApaasBase()) : "";
  if (!responseUrl) return;
  cookies.forEach((cookie) => {
    try {
      jar.setCookieSync(cookie, responseUrl, { ignoreError: true });
    } catch (error) {
      // Non-fatal cookie parse failure.
    }
  });
}

function createApaasClient(jar, options = {}) {
  const timeout = Math.max(5000, Number(process.env.FOSU_IMPORT_TIMEOUT_MS || 25000) || 25000);
  const instance = axiosClient.create({
    jar,
    timeout,
    withCredentials: true,
    responseType: "arraybuffer",
    maxRedirects: options.maxRedirects == null ? 5 : options.maxRedirects,
    validateStatus: options.validateStatus || ((status) => status >= 200 && status < 400),
    headers: {
      "User-Agent": process.env.FOSU_IMPORT_MOBILE_UA || DEFAULT_BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    },
  });
  instance.interceptors.response.use((response) => {
    storeResponseCookies(jar, response);
    const contentType = response.headers["content-type"] || "";
    if (Buffer.isBuffer(response.data) || response.data instanceof ArrayBuffer) {
      const buffer = Buffer.from(response.data);
      response.data = /gbk|gb2312/i.test(contentType) ? iconv.decode(buffer, "gbk") : iconv.decode(buffer, "utf8");
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
  const errorText = $(".error, .error-tip, .login-error, #msg, .msg, .tips").text().replace(/\s+/g, " ");
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
    if (name) fields[name] = $(el).attr("value") || "";
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
  const encryptedPassword = fields.pwdEncryptSalt ? encryptFosuPassword(password, fields.pwdEncryptSalt) : password;
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
  if (/账号已被锁定|账户已被锁定|账号锁定/.test(text)) return "ACCOUNT_LOCKED";
  if (/拒绝|禁止登录|不允许登录/.test(text)) return "SCHOOL_SYSTEM_REJECTED";
  if (/密码错误|用户名或密码|账号或密码|认证失败|登录失败|不存在/.test(text)) return "INVALID_CREDENTIALS";
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
    if (!location || ![301, 302, 303, 307, 308].includes(response.status)) break;
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
  const apaasBase = getApaasBase();
  const backurl = `${apaasBase}/m/oauth/succ?redirect=${encodeURIComponent(redirect)}&authmode=${encodeURIComponent(authmode)}&ticket=${encodeURIComponent(ticket)}`;
  const response = await client.post(`${apaasBase}/api/authorize`, JSON.stringify({ redirect, authmode, ticket, backurl }), {
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
  return response;
}

async function verifyApaasSession(client) {
  const response = await client.post(`${getApaasBase()}/api/profile/userinfo`, "", {
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: `${getApaasBase()}/m/dashboard`,
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

async function loginWithCasHttp(studentId, password, timing) {
  const jar = new CookieJar();
  const client = createApaasClient(jar, { maxRedirects: 0 });
  const startedAt = Date.now();
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
    localPassword = "";
    if (loginPost.status === 200 && isLoginPage(loginPost.data, loginUrl)) {
      const code = classifyLoginFailure(loginPost.data);
      const error = new Error(code);
      error.code = code;
      throw error;
    }
    if (loginPost.headers.location) {
      const nextUrl = resolveUrl(loginPost.headers.location, loginUrl);
      if (isApaasCasCallback(nextUrl)) await authorizeApaasCasSession(client, nextUrl);
      else await followRedirects(client, nextUrl);
    }
    const verifiedClient = createApaasClient(jar);
    await verifyApaasSession(verifiedClient);
    const dashboard = await verifiedClient.get(`${getApaasBase()}/dashboard`, {
      validateStatus: (status) => status >= 200 && status < 400,
    });
    if (isLoginPage(dashboard.data, dashboard.config.url)) {
      const error = new Error("INVALID_CREDENTIALS");
      error.code = "INVALID_CREDENTIALS";
      throw error;
    }
    timing.loginMs = Date.now() - startedAt;
    safeLog("fosu-import-relay-login-success", {
      studentId: maskStudentId(studentId),
      loginMs: timing.loginMs,
    });
    return { jar, client: verifiedClient, dashboardHtml: dashboard.data };
  } finally {
    localPassword = "";
  }
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
  const seen = new Set();
  return entries.find((entry) => {
    if (!entry.url || seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  }) || null;
}

function parseJsonMaybe(text) {
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
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
  const sourceCode = toText(source && (source.code || source.sourceCode || source.formCode || source.resourceCode));
  const formId = toText(source && (source.id || source.formId || source.sourceId));
  const title = toText(source && (source.title || source.name || source.label)) || "本科生学生课表";
  const code = sourceCode || formId;
  if (!appId || !code) return null;
  return {
    url: `${getApaasBase()}/m/dashboard/app/${appId}/source/${code}`,
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
  for (const endpoint of ["/api/dashboard/preferences", "/api/dashboard/favorite"]) {
    try {
      const response = await session.client.get(`${apaasBase}${endpoint}`, {
        headers: { Accept: "application/json, text/plain, */*" },
        validateStatus: (status) => status >= 200 && status < 500,
      });
      collectObjects(responseData(response)).forEach((item) => {
        if (!item || !matchScheduleText(item.name || item.title || item.label)) return;
        const appId = toText(item.appId || item.id);
        if (appId && !candidateAppIds.includes(appId)) candidateAppIds.push(appId);
      });
    } catch (error) {
      safeLog("fosu-import-relay-entry-candidate-failed", { endpoint, code: error.code || error.message });
    }
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
      const source = collectObjects(responseData(menu)).find((item) => item && matchScheduleText(item.title || item.name || item.label));
      const entry = buildEntryFromSource(appId, source, "app-menu-api");
      if (entry) return entry;
    } catch (error) {
      safeLog("fosu-import-relay-app-menu-failed", { appId, code: error.code || error.message });
    }
  }
  return null;
}

function cloneAppEntry(entry) {
  return entry ? Object.assign({}, entry) : null;
}

function getCachedStudentScheduleApp() {
  if (appEntryCache.entry && appEntryCache.expiresAtMs > Date.now()) return cloneAppEntry(appEntryCache.entry);
  return null;
}

function setCachedStudentScheduleApp(entry) {
  if (!entry || entry.fallback) return;
  appEntryCache.entry = cloneAppEntry(entry);
  appEntryCache.expiresAtMs = Date.now() + APP_ENTRY_CACHE_TTL_MS;
}

async function fetchApaasDashboard(session) {
  const apaasBase = getApaasBase();
  for (const url of [`${apaasBase}/dashboard`, `${apaasBase}/m/dashboard`, `${apaasBase}/`]) {
    const response = await session.client.get(url, {
      validateStatus: (status) => status >= 200 && status < 400,
    });
    if (!isLoginPage(response.data, response.config.url)) return response.data;
  }
  const error = new Error("APAAS_DASHBOARD_UNAVAILABLE");
  error.code = "APAAS_DASHBOARD_UNAVAILABLE";
  throw error;
}

async function findStudentScheduleApp(session, timing) {
  const startedAt = Date.now();
  const cached = getCachedStudentScheduleApp();
  if (cached) {
    timing.discoverMs = Date.now() - startedAt;
    return cached;
  }
  const apiEntry = await findStudentScheduleAppFromApi(session);
  if (apiEntry) {
    setCachedStudentScheduleApp(apiEntry);
    timing.discoverMs = Date.now() - startedAt;
    return apiEntry;
  }
  const apaasBase = getApaasBase();
  const dashboardHtml = session.dashboardHtml || await fetchApaasDashboard(session);
  const found = findStudentScheduleAppInHtml(dashboardHtml, apaasBase);
  if (found) {
    setCachedStudentScheduleApp(found);
    timing.discoverMs = Date.now() - startedAt;
    return found;
  }
  safeLog("fosu-import-relay-entry-fallback", { reason: "dynamic-discovery-empty" });
  timing.discoverMs = Date.now() - startedAt;
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
    if (rows.length) results.push(rows);
    value.forEach((item) => collectScheduleRowsFromJson(item, results));
    return results;
  }
  if (typeof value === "object") Object.keys(value).forEach((key) => collectScheduleRowsFromJson(value[key], results));
  return results;
}

function extractRowsFromEmbeddedJson(html) {
  const $ = cheerio.load(String(html || ""));
  const candidates = [];
  $("script[type='application/json'], script#__NEXT_DATA__").each((i, el) => {
    const parsed = parseJsonMaybe($(el).text());
    if (parsed) candidates.push(parsed);
  });
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
      if (cells.filter((cell) => REQUIRED_ROW_KEYS.includes(cell)).length >= 3) {
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
  [/["'](\/api\/[^"']+)["']/g, /["']([^"']+\/api\/[^"']+)["']/g, /url\s*:\s*["']([^"']+)["']/g].forEach((pattern) => {
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
  return [
    `/api/dashboard/app/${appId}/form/${formOrSource}/data`,
    `/api/dashboard/app/${appId}/source/${sourceId}/data`,
    `/api/app/${appId}/form/${formOrSource}/data`,
    `/api/app/${appId}/source/${sourceId}/data`,
    `/api/form/${formOrSource}/data`,
    `/api/source/${sourceId}/data`,
  ].filter((path) => appId && formOrSource && !path.includes("//")).map((path) => `${apaasBase}${path}`);
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
  return { rows, info: extractPaginationInfo(payload, rows) };
}

async function fetchRowsFromJsonApiPageWithRetry(session, url, page, pageSize) {
  try {
    return await fetchRowsFromJsonApiPage(session, url, page, pageSize);
  } catch (error) {
    safeLog("fosu-import-relay-json-page-retry", { page, code: error.code || error.message });
    return fetchRowsFromJsonApiPage(session, url, page, pageSize);
  }
}

async function fetchRowsFromJsonApi(session, url) {
  const allRows = [];
  const seenKeys = new Set();
  const requestedPageSize = Number(process.env.FOSU_APAAS_PAGE_SIZE || 500) || 500;
  const first = await fetchRowsFromJsonApiPage(session, url, 1, requestedPageSize);
  const addRows = (rows) => {
    (rows || []).forEach((row) => {
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
  for (let page = 2; page <= pageCount; page += 1) tasks.push(() => fetchRowsFromJsonApiPageWithRetry(session, url, page, pageSize));
  const pages = await runLimited(tasks, Number(process.env.FOSU_APAAS_PAGE_CONCURRENCY || 3) || 3);
  pages.forEach((pageResult) => addRows(pageResult && pageResult.rows || []));
  return allRows;
}

function normalizeApaasCellValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => normalizeApaasCellValue(item)).filter(Boolean).join(",");
  if (typeof value === "object") return toText(value.title || value.name || value.label || value.value || value.text || value.code || "");
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
    if (label && code) results.push({ label, code });
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
      if (value && !mapped[column.label]) mapped[column.label] = value;
    });
    if (row && row.id) mapped.__apaasRowId = toText(row.id);
    return mapped;
  }).filter((row) => toText(row["课程名称"]) || looksLikeScheduleRow(row));
}

async function fetchApaasFormDefinition(session, entry) {
  const appId = entry.appId || "42";
  const formCode = entry.formCode || entry.sourceCode || entry.formId || entry.sourceId;
  if (!appId || !formCode) return null;
  const response = await session.client.post(`${getApaasBase()}/api/app/${appId}/form/${formCode}`, "", {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      Referer: `${getApaasBase()}/m/dashboard/app/${appId}/source/${formCode}`,
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
  const body = buildApaasDataQueryBody(entry, formDefinition, from, size);
  if (!body.appId || !body.formId || !body.formCode) return { rows: [], total: 0, rawCount: 0 };
  const response = await session.client.post(`${getApaasBase()}/api/data/query`, JSON.stringify(body), {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      Referer: `${getApaasBase()}/m/dashboard/app/${body.appId}/source/${body.formCode}`,
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });
  if (response.status >= 400) return { rows: [], total: 0, rawCount: 0 };
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
    safeLog("fosu-import-relay-data-query-page-retry", { from, code: error.code || error.message });
    return fetchApaasDataQueryPage(session, entry, formDefinition, columns, from, size);
  }
}

async function fetchRowsFromApaasDataQuery(session, entry) {
  if (!entry || !entry.appId || !(entry.formCode || entry.sourceCode || entry.formId || entry.sourceId)) return [];
  const formDefinition = await fetchApaasFormDefinition(session, entry);
  if (!formDefinition) return [];
  entry.formId = toText(entry.formId || formDefinition.id);
  entry.sourceId = toText(entry.sourceId || formDefinition.id);
  entry.formCode = toText(entry.formCode || formDefinition.code);
  entry.sourceCode = toText(entry.sourceCode || formDefinition.code);
  const columns = collectFormColumns(formDefinition.columns || formDefinition.formJson || formDefinition);
  const allRows = [];
  const seenKeys = new Set();
  const pageSize = Math.min(500, Math.max(20, Number(process.env.FOSU_APAAS_PAGE_SIZE || 500) || 500));
  const addRows = (rows) => {
    (rows || []).forEach((row) => {
      const key = JSON.stringify(row);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allRows.push(row);
      }
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

async function fetchScheduleRows(session, appEntry, timing) {
  const startedAt = Date.now();
  const entryUrl = appEntry && appEntry.url;
  if (!entryUrl) {
    const error = new Error("APAAS_STRUCTURE_CHANGED");
    error.code = "APAAS_STRUCTURE_CHANGED";
    throw error;
  }
  const dataQueryRows = await fetchRowsFromApaasDataQuery(session, appEntry);
  if (dataQueryRows.length) {
    timing.fetchRowsMs = Date.now() - startedAt;
    return dataQueryRows;
  }
  const page = await session.client.get(entryUrl, {
    validateStatus: (status) => status >= 200 && status < 400,
  });
  if (isLoginPage(page.data, page.config.url)) {
    const error = new Error("APAAS_SESSION_EXPIRED");
    error.code = "APAAS_SESSION_EXPIRED";
    throw error;
  }
  const embeddedRows = extractRowsFromEmbeddedJson(page.data);
  if (embeddedRows.length) {
    timing.fetchRowsMs = Date.now() - startedAt;
    return embeddedRows;
  }
  const apiUrls = discoverApiUrls(page.data, entryUrl).concat(buildFallbackApiCandidates(appEntry));
  for (const apiUrl of apiUrls) {
    try {
      const rows = await fetchRowsFromJsonApi(session, apiUrl);
      if (rows.length) {
        timing.fetchRowsMs = Date.now() - startedAt;
        return rows;
      }
    } catch (error) {
      safeLog("fosu-import-relay-json-candidate-failed", {
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
      safeLog("fosu-import-relay-pagination-failed", { code: error.code || error.message });
    }
  }
  if (tableRows.length) {
    timing.fetchRowsMs = Date.now() - startedAt;
    return tableRows;
  }
  const error = new Error("APAAS_STRUCTURE_CHANGED");
  error.code = "APAAS_STRUCTURE_CHANGED";
  throw error;
}

function destroySession(session) {
  if (!session) return;
  session.client = null;
  session.jar = null;
  session.dashboardHtml = null;
}

function normalizeRelayErrorCode(error) {
  const status = Number(error && (error.status || error.response && error.response.status) || 0);
  const raw = String(error && (error.code || error.message) || "CLOUDBASE_IMPORT_FAILED").toUpperCase();
  if (status === 408 || status === 504) return "UPSTREAM_TIMEOUT";
  if (status >= 500) return "SCHOOL_SYSTEM_TIMEOUT";
  if (status === 401 || status === 403 || status === 429) return "CLOUDBASE_SERVICE_UNAVAILABLE";
  if (/ETIMEDOUT|ECONNABORTED|ESOCKETTIMEDOUT|TIMEOUT/.test(raw)) return "SCHOOL_SYSTEM_TIMEOUT";
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_NETWORK|SOCKET/.test(raw)) return "NETWORK_TIMEOUT";
  const known = new Set([
    "CLOUDBASE_IMPORT_NOT_CONFIGURED",
    "CLOUDBASE_SERVICE_UNAVAILABLE",
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
    "APAAS_SESSION_EXPIRED",
    "SCHEDULE_EMPTY",
  ]);
  return known.has(raw) ? raw : "CLOUDBASE_IMPORT_FAILED";
}

function summarizeRelayError(error) {
  const response = error && error.response || {};
  const config = error && error.config || response.config || {};
  const url = config.url || response.request && response.request.res && response.request.res.responseUrl || "";
  let upstreamHost = "";
  let upstreamPath = "";
  try {
    const parsed = new URL(String(url || ""), config.baseURL || getApaasBase());
    upstreamHost = parsed.host;
    upstreamPath = parsed.pathname;
  } catch (_) {}
  return {
    rawCode: String(error && error.code || ""),
    status: Number(error && error.status || response.status || 0) || 0,
    upstreamHost,
    upstreamPath,
  };
}

function sanitizeErrorMessage(message) {
  const raw = toText(message);
  if (!raw || /<!doctype|<html|<body|<\/html>/i.test(raw)) return "CloudBase import relay failed";
  return raw
    .replace(/(password|passwd|pwd|cookie|ticket|token|authorization|session)\s*[:=]\s*[^,\s;&]+/ig, "$1=[REDACTED]")
    .replace(/JSESSIONID=[^;\s]+/ig, "JSESSIONID=[REDACTED]")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "CloudBase import relay failed";
}

function statusForErrorCode(code) {
  if (["SCHOOL_SYSTEM_TIMEOUT", "NETWORK_TIMEOUT", "UPSTREAM_TIMEOUT"].includes(code)) return 504;
  if (["CLOUDBASE_IMPORT_NOT_CONFIGURED", "CLOUDBASE_SERVICE_UNAVAILABLE", "CLOUDBASE_IMPORT_FAILED"].includes(code)) return 503;
  if (code === "UNAUTHORIZED") return 401;
  return 200;
}

async function buildRelayPayload(body) {
  const studentId = toText(body && body.studentId);
  let password = String(body && body.password || "");
  if (!/^\d{8,20}$/.test(studentId) || !password) {
    return {
      status: 200,
      payload: { success: false, code: "INVALID_CREDENTIALS", message: "Invalid student credentials" },
    };
  }
  const timing = { channel: "cloudbase", retryCount: 0, loginMs: 0, discoverMs: 0, fetchRowsMs: 0 };
  const startedAt = Date.now();
  let session = null;
  let stage = "login";
  try {
    session = await loginWithCasHttp(studentId, password, timing);
    password = "";
    stage = "discover";
    const entry = await findStudentScheduleApp(session, timing);
    stage = "fetchRows";
    const rawRows = await fetchScheduleRows(session, entry, timing);
    if (!rawRows.length) {
      const error = new Error("SCHEDULE_EMPTY");
      error.code = "SCHEDULE_EMPTY";
      throw error;
    }
    timing.totalMs = Date.now() - startedAt;
    safeLog("fosu-import-relay-success", {
      studentId: maskStudentId(studentId),
      rowCount: rawRows.length,
      channel: "cloudbase",
      loginMs: timing.loginMs,
      discoverMs: timing.discoverMs,
      fetchRowsMs: timing.fetchRowsMs,
      totalMs: timing.totalMs,
    });
    return {
      status: 200,
      payload: {
        success: true,
        channel: "cloudbase",
        rawRows,
        rows: rawRows,
        appEntry: {
          appId: entry.appId || "",
          formId: entry.formId || "",
          sourceId: entry.sourceId || "",
          formCode: entry.formCode || "",
          sourceCode: entry.sourceCode || "",
          discoveredBy: entry.discoveredBy || "",
          fallback: Boolean(entry.fallback),
        },
        timing,
      },
    };
  } catch (error) {
    const code = normalizeRelayErrorCode(error);
    if (stage === "login" && !timing.loginMs) timing.loginMs = Date.now() - startedAt;
    timing.totalMs = Date.now() - startedAt;
    timing.failureStage = stage;
    const errorSummary = summarizeRelayError(error);
    safeLog("fosu-import-relay-failed", {
      studentId: maskStudentId(studentId),
      channel: "cloudbase",
      code,
      stage,
      upstreamStatus: errorSummary.status,
      upstreamHost: errorSummary.upstreamHost,
      upstreamPath: errorSummary.upstreamPath,
      upstreamCode: errorSummary.rawCode,
      loginMs: timing.loginMs,
      discoverMs: timing.discoverMs,
      fetchRowsMs: timing.fetchRowsMs,
      totalMs: timing.totalMs,
    });
    return {
      status: statusForErrorCode(code),
      payload: {
        success: false,
        code,
        message: sanitizeErrorMessage(code),
        timing,
      },
    };
  } finally {
    password = "";
    destroySession(session);
  }
}

async function probeUpstreamLoginPage() {
  const startedAt = Date.now();
  const jar = new CookieJar();
  const client = createApaasClient(jar, { maxRedirects: 0 });
  const loginUrl = buildCasLoginUrl("/dashboard");
  try {
    const response = await client.get(loginUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const fields = parseCasLoginForm(response.data);
    const verification = detectHumanVerification(response.data);
    const hasLoginForm = Boolean(fields.execution || fields.lt || fields.pwdEncryptSalt);
    if (response.status >= 400 || !hasLoginForm || verification) {
      const error = new Error(verification || "LOGIN_PAGE_CHANGED");
      error.code = verification || "LOGIN_PAGE_CHANGED";
      error.status = response.status;
      throw error;
    }
    return {
      success: true,
      ok: true,
      channel: "cloudbase",
      probe: "upstream-login",
      authStatus: response.status,
      hasLoginForm,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const code = normalizeRelayErrorCode(error);
    const summary = summarizeRelayError(error);
    safeLog("fosu-import-relay-upstream-probe-failed", {
      code,
      upstreamStatus: summary.status,
      upstreamHost: summary.upstreamHost,
      upstreamPath: summary.upstreamPath,
      upstreamCode: summary.rawCode,
      elapsedMs: Date.now() - startedAt,
    });
    return {
      success: false,
      ok: false,
      channel: "cloudbase",
      probe: "upstream-login",
      code,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function tokenConfigured() {
  return Boolean(toText(process.env.FOSU_IMPORT_RELAY_TOKEN || process.env.FOSU_IMPORT_CLOUDBASE_RELAY_TOKEN));
}

function validateRelayToken(req) {
  const expected = toText(process.env.FOSU_IMPORT_RELAY_TOKEN || process.env.FOSU_IMPORT_CLOUDBASE_RELAY_TOKEN);
  if (!expected) return { ok: false, code: "CLOUDBASE_IMPORT_NOT_CONFIGURED" };
  const relayHeader = toText(req.headers["x-fosu-relay-token"] || req.headers["X-Fosu-Relay-Token"] || "");
  const authHeader = toText(req.headers.authorization || req.headers.Authorization || "");
  const provided = (relayHeader || authHeader.replace(/^Bearer\s+/i, "")).trim();
  if (!provided) return { ok: false, code: "UNAUTHORIZED" };
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return { ok: false, code: "UNAUTHORIZED" };
  return { ok: crypto.timingSafeEqual(left, right), code: "UNAUTHORIZED" };
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Fosu-Relay-Token",
  };
}

function eventResponse(statusCode, payload) {
  return {
    statusCode,
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, jsonHeaders());
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 256 * 1024) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        const invalid = new Error("INVALID_JSON");
        invalid.code = "INVALID_JSON";
        reject(invalid);
      }
    });
    req.on("error", reject);
  });
}

async function handleHttpRequest(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    if (url.searchParams.get("probe") === "upstream") {
      sendJson(res, 200, await probeUpstreamLoginPage());
      return;
    }
    sendJson(res, 200, { success: true, ok: true, tokenConfigured: tokenConfigured(), channel: "cloudbase" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }
  const token = validateRelayToken(req);
  if (!token.ok) {
    sendJson(res, statusForErrorCode(token.code), {
      success: false,
      code: token.code,
      message: token.code === "UNAUTHORIZED" ? "Unauthorized" : "CloudBase import relay is not configured",
    });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const result = await buildRelayPayload(body);
    sendJson(res, result.status, result.payload);
  } catch (error) {
    const code = normalizeRelayErrorCode(error);
    sendJson(res, statusForErrorCode(code), {
      success: false,
      code,
      message: sanitizeErrorMessage(code),
    });
  }
}

function eventMethod(event) {
  return String(event && (event.httpMethod || event.method || event.requestContext && event.requestContext.httpMethod || "") || "GET").toUpperCase();
}

function eventHeaders(event) {
  return event && (event.headers || event.header || event.Headers) || {};
}

function eventQuery(event) {
  return event && (event.queryStringParameters || event.query || event.queryString || event.QueryStringParameters) || {};
}

function parseEventBody(event) {
  const body = event && event.body;
  if (!body) return {};
  const text = event.isBase64Encoded ? Buffer.from(String(body), "base64").toString("utf8") : String(body);
  if (!text) return {};
  return JSON.parse(text);
}

async function main(event) {
  const method = eventMethod(event);
  if (method === "OPTIONS") return eventResponse(204, {});
  if (method === "GET") {
    const query = eventQuery(event);
    if (query && query.probe === "upstream") {
      return eventResponse(200, await probeUpstreamLoginPage());
    }
    return eventResponse(200, { success: true, ok: true, tokenConfigured: tokenConfigured(), channel: "cloudbase" });
  }
  if (method !== "POST") {
    return eventResponse(405, { success: false, code: "METHOD_NOT_ALLOWED" });
  }
  const token = validateRelayToken({ headers: eventHeaders(event) });
  if (!token.ok) {
    return eventResponse(statusForErrorCode(token.code), {
      success: false,
      code: token.code,
      message: token.code === "UNAUTHORIZED" ? "Unauthorized" : "CloudBase import relay is not configured",
    });
  }
  try {
    const result = await buildRelayPayload(parseEventBody(event));
    return eventResponse(result.status, result.payload);
  } catch (error) {
    const code = normalizeRelayErrorCode(error);
    return eventResponse(statusForErrorCode(code), {
      success: false,
      code,
      message: sanitizeErrorMessage(code),
    });
  }
}

const server = http.createServer((req, res) => {
  handleHttpRequest(req, res).catch((error) => {
    safeLog("fosu-import-relay-unhandled", { code: error.code || error.message });
    sendJson(res, 503, { success: false, code: "CLOUDBASE_SERVICE_UNAVAILABLE", message: "CloudBase import relay failed" });
  });
});

if (require.main === module) {
  server.listen(9000, () => {
    safeLog("fosu-import-relay-listen", { port: 9000, tokenConfigured: tokenConfigured() });
  });
}

module.exports = {
  buildRelayPayload,
  handleHttpRequest,
  main,
  maskStudentId,
  normalizeRelayErrorCode,
  probeUpstreamLoginPage,
  redactSecrets,
  sanitizeErrorMessage,
  server,
  validateRelayToken,
};
