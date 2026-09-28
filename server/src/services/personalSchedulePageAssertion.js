function looksLikeTimetable(html) {
  return /id=["']kbtable["']/i.test(String(html || "")) || /<table\b[^>]*\bkbtable\b/i.test(String(html || ""));
}

function hasTimetableStructure(html) {
  const source = String(html || "");
  return looksLikeTimetable(source) && /星期一/.test(source) && /星期二/.test(source);
}

function classifyTimetableDocument(html, pageUrl) {
  const source = String(html || "");
  const url = String(pageUrl || "");
  const visible = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const authUrl = /authserver\.fosu\.edu\.cn|\/authserver\/|caslogin\.jsp|(?:^|\/)login\.jsp/i.test(url);
  const loginForm = /name=["']password["']/i.test(source)
    || /id=["']pwdFrom/i.test(source)
    || /type=["']password["']/i.test(source);
  const rejected = /密码错误|用户名或密码|账号或密码|认证失败|登录失败/.test(visible);
  if (authUrl || loginForm || rejected) return "INVALID_CREDENTIALS";
  if (/统一身份认证|中央认证|请输入用户名/.test(visible) && !hasTimetableStructure(source)) return "INVALID_CREDENTIALS";
  if (/系统维护|服务不可用|网关超时|502 Bad Gateway|504 Gateway/.test(visible)) return "SCHOOL_UNAVAILABLE";
  if (hasTimetableStructure(source)) return "AUTHENTICATED_TIMETABLE";
  return "STRUCTURE_CHANGED";
}

module.exports = {
  classifyTimetableDocument,
  hasTimetableStructure,
};
