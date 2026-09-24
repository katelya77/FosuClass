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

function parseCasLoginFields(html) {
  return {
    execution: inputValue(html, "execution"),
    pwdEncryptSalt: inputValue(html, "pwdEncryptSalt"),
    lt: inputValue(html, "lt"),
    _eventId: inputValue(html, "_eventId") || "submit",
    cllt: inputValue(html, "cllt") || "userNameLogin",
    dllt: inputValue(html, "dllt") || "generalLogin",
  };
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

function isAuthenticatedHome(html, statusCode) {
  const text = String(html || "");
  return statusCode === 200 && (text.includes("桌面") || text.includes("教学综合信息服务平台"));
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
  looksLikeTimetable,
  maskStudentId,
  parseCasLoginFields,
  parseSemesterOptions,
};
