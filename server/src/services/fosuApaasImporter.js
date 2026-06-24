const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const cheerio = require("cheerio");
const iconv = require("iconv-lite");
const config = require("../config");
const { encryptFosuPassword } = require("../utils/fosu-password-encrypt");
const { safeLog, maskStudentId } = require("../utils/safeLogger");
const { buildImportPreview } = require("../utils/fosuApaasScheduleParser");

const axiosClient = wrapper(axios.default || axios);
const SCHEDULE_KEYWORDS = ["本科生学生课表", "学生课表", "课表"];
const REQUIRED_ROW_KEYS = ["学生姓名", "课程名称", "周次", "星期几", "节次", "课室名称", "上课班级", "校区", "特别说明"];

// Known links are only a last-resort fallback. APaaS app/source ids can change.
const FALLBACK_ENTRIES = [
  "/dashboard/app/42/form/22adbc6ad6b14909b15fd31a4b230c1d",
  "/m/dashboard/app/42/source/22adbc6ad6b14909b15fd31a4b230c1d",
];

function toText(value) {
  return String(value == null ? "" : value).trim();
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
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49",
      Accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    },
  });

  instance.interceptors.response.use((response) => {
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
  if (/滑块验证|拖动滑块|人机验证|riskControl|风险拦截|风控/i.test(content)) return "RISK_CONTROL_REQUIRED";
  const $ = cheerio.load(content);
  const visibleCaptchaInput = $("input[name='captcha'], input#captcha, input[name='jcaptchaCode']").filter((i, el) => {
    const type = String($(el).attr("type") || "").toLowerCase();
    return type !== "hidden";
  });
  if (visibleCaptchaInput.length || $("img[id*='captcha'], img[src*='captcha']").length) {
    return "CAPTCHA_REQUIRED";
  }
  return "";
}

function parseCasLoginForm(html) {
  const $ = cheerio.load(String(html || ""));
  const fields = {};
  $("input").each((i, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    fields[name] = $(el).attr("value") || "";
  });
  fields.execution = fields.execution || $("#execution").val() || "";
  fields.lt = fields.lt || $("#lt").val() || "";
  fields.pwdEncryptSalt = fields.pwdEncryptSalt || $("#pwdEncryptSalt").val() || "";
  return fields;
}

function buildLoginPostData(fields, studentId, password) {
  const encryptedPassword = fields.pwdEncryptSalt
    ? encryptFosuPassword(password, fields.pwdEncryptSalt)
    : password;
  const postData = new URLSearchParams();
  Object.keys(fields || {}).forEach((key) => {
    if (!["username", "password", "captcha"].includes(key)) {
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

async function loginWithCas(studentId, password) {
  const jar = new CookieJar();
  const client = createApaasClient(jar, { maxRedirects: 0 });
  const apaasBase = getApaasBase();
  const startedAt = Date.now();
  let localPassword = password;

  try {
    safeLog("fosu-apaas-login-start", { studentId: maskStudentId(studentId) });
    const landing = await client.get(`${apaasBase}/`, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    let loginUrl = "";
    if ([301, 302, 303, 307, 308].includes(landing.status) && landing.headers.location) {
      loginUrl = resolveUrl(landing.headers.location, `${apaasBase}/`);
    } else if (isLoginPage(landing.data, landing.request && landing.request.res && landing.request.res.responseUrl)) {
      loginUrl = landing.config.url;
    } else {
      return { jar, client: createApaasClient(jar), dashboardHtml: landing.data, loggedIn: true };
    }

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
    const loginPost = await client.post(loginUrl, postBody, {
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
      await followRedirects(client, resolveUrl(loginPost.headers.location, loginUrl));
    }

    const verifiedClient = createApaasClient(jar);
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

async function findStudentScheduleApp(session) {
  const apaasBase = getApaasBase();
  const dashboardHtml = session.dashboardHtml || await fetchApaasDashboard(session);
  const found = findStudentScheduleAppInHtml(dashboardHtml, apaasBase);
  if (found) return found;

  for (const path of ["/dashboard", "/m/dashboard"]) {
    const response = await session.client.get(`${apaasBase}${path}`, {
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const entry = findStudentScheduleAppInHtml(response.data, `${apaasBase}${path}`);
    if (entry) return entry;
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

async function fetchRowsFromJsonApi(session, url) {
  const allRows = [];
  const seenKeys = new Set();
  let page = 1;
  let total = 0;
  let pageSize = 100;

  while (page <= 100) {
    const target = new URL(url);
    target.searchParams.set("page", String(page));
    target.searchParams.set("current", String(page));
    target.searchParams.set("pageSize", String(pageSize));
    target.searchParams.set("size", String(pageSize));
    const response = await session.client.get(target.toString(), {
      headers: { Accept: "application/json,text/plain,*/*" },
      validateStatus: (status) => status >= 200 && status < 500,
    });
    if (response.status >= 400) break;
    const payload = parseJsonMaybe(response.data) || response.data;
    const groups = collectScheduleRowsFromJson(payload, []);
    const rows = groups.sort((left, right) => right.length - left.length)[0] || [];
    if (!rows.length) break;

    rows.forEach((row) => {
      const key = JSON.stringify(row);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allRows.push(row);
      }
    });
    const info = extractPaginationInfo(payload, rows);
    total = total || info.total;
    pageSize = info.pageSize || pageSize;
    if (total && allRows.length >= total) break;
    if (rows.length < pageSize && !total) break;
    page += 1;
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
  return buildImportPreview(rawRows, options);
}

function destroySession(session) {
  if (!session) return;
  session.client = null;
  session.jar = null;
  session.dashboardHtml = null;
}

async function importSchedulePreview(studentId, password, options = {}) {
  let session = null;
  try {
    session = await loginWithCas(studentId, password);
    const entry = await findStudentScheduleApp(session);
    const rawRows = await fetchScheduleRows(session, entry);
    if (!rawRows.length) {
      const error = new Error("SCHEDULE_EMPTY");
      error.code = "SCHEDULE_EMPTY";
      throw error;
    }
    return normalizeRowsForPreview(rawRows, {
      studentId,
      semester: options.semester || "当前学期",
      importedAt: options.importedAt || new Date().toISOString(),
      appEntry: entry,
    });
  } finally {
    destroySession(session);
  }
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
  parseCasLoginForm,
  parseEntryFromUrl,
};
