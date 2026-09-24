function inputValue(html, name) {
  const source = String(html || "");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<input\\b[^>]*\\bname=["']${escaped}["'][^>]*\\bvalue=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<input\\b[^>]*\\bvalue=["']([^"']*)["'][^>]*\\bname=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<input\\b[^>]*\\bid=["']${escaped}["'][^>]*\\bvalue=["']([^"']*)["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function parseCasLoginFields(html, pageUrl) {
  const source = String(html || "");
  const formMatch = source.match(/<form\b[^>]*\bid=["']pwdFromId["'][^>]*>([\s\S]*?)<\/form>/i);
  const scope = formMatch ? formMatch[0] : source;
  const action = (scope.match(/\baction=["']([^"']+)["']/i) || [])[1] || "";
  return {
    execution: inputValue(scope, "execution") || inputValue(source, "execution"),
    pwdEncryptSalt: inputValue(source, "pwdEncryptSalt"),
    lt: inputValue(scope, "lt") || inputValue(source, "lt"),
    _eventId: inputValue(scope, "_eventId") || "submit",
    cllt: inputValue(scope, "cllt") || "userNameLogin",
    dllt: inputValue(scope, "dllt") || "generalLogin",
    postUrl: resolveLoginPostUrl(pageUrl, action),
  };
}

const { resolveRelativeUrl, splitUrl } = require("./fosuDirectUrl");

function resolveLoginPostUrl(pageUrl, action) {
  const page = String(pageUrl || "");
  if (!page) return String(action || "");
  if (!action) return page;
  const resolved = splitUrl(resolveRelativeUrl(page, action));
  const current = splitUrl(page);
  if (!resolved || !current) return page;
  if (!resolved.search && current.search && resolved.pathname === current.pathname) return page;
  return resolveRelativeUrl(page, action);
}

function captchaRequiredFromCheck(payload) {
  let data = payload;
  if (data && typeof data !== "string" && data.byteLength) return false;
  if (typeof data === "string") {
    const text = data.trim();
    if (/^true$/i.test(text)) return true;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return /"(?:isNeed|needCaptcha)"\s*:\s*true/i.test(text);
    }
  }
  if (!data || typeof data !== "object") return false;
  return data.isNeed === true || data.isNeed === "true" || data.needCaptcha === true || data.needCaptcha === "true";
}

function classifyLoginPage(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (/验证码|滑块|拼图|人机验证|安全验证/.test(text)) return "INTERACTIVE_CHALLENGE_REQUIRED";
  if (/密码错误|用户名或密码|账号或密码|认证失败/.test(text)) return "INVALID_CREDENTIALS";
  if (/name=["']username["']/i.test(html) && /name=["']password["']/i.test(html)) return "LOGIN_REJECTED";
  return "";
}

function hasTicket(location) {
  return /(?:^|[?&])ticket=/.test(String(location || ""));
}

function looksLikeLoginPage(html) {
  const text = String(html || "");
  return /name=["']password["']/i.test(text) || /id=["']pwdFrom["']/i.test(text);
}

function isAuthenticatedHome(html, statusCode) {
  const text = String(html || "");
  if (Number(statusCode || 0) !== 200 || looksLikeLoginPage(text)) return false;
  return text.includes("桌面") || text.includes("教学综合信息服务平台");
}

function parseSemesterOptions(html) {
  const source = String(html || "");
  const select = source.match(/<select\b[^>]*(?:id|name)=["']xnxq01id["'][^>]*>([\s\S]*?)<\/select>/i);
  if (!select) return { options: [], current: "" };
  const options = [];
  const pattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let match = pattern.exec(select[1]);
  let current = "";
  while (match) {
    const attrs = match[1] || "";
    const value = (attrs.match(/\bvalue=["']([^"']*)["']/i) || [])[1] || "";
    if (/selected/i.test(attrs)) current = value;
    if (value) options.push({ code: value, name: match[2].replace(/<[^>]+>/g, "").trim() });
    match = pattern.exec(select[1]);
  }
  return { options, current: current || (options[0] && options[0].code) || "" };
}

function looksLikeTimetable(html) {
  return /id=["']kbtable["']/i.test(String(html || "")) || /<table\b[^>]*\bkbtable\b/i.test(String(html || ""));
}

function maskStudentId(studentId) {
  const value = String(studentId || "").trim();
  if (value.length < 8) return "";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

module.exports = {
  captchaRequiredFromCheck,
  classifyLoginPage,
  hasTicket,
  isAuthenticatedHome,
  looksLikeLoginPage,
  looksLikeTimetable,
  maskStudentId,
  parseCasLoginFields,
  resolveLoginPostUrl,
  parseSemesterOptions,
};
