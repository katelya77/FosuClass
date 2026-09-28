const ALLOWED = new Set(["studentId", "password", "semester", "wxCode"]);
const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);

function reject(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertJobBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw reject("CAMPUS_SYNC_BODY_REJECTED");
  const keys = Object.keys(body);
  keys.forEach((key) => {
    if (DANGEROUS.has(key) || !ALLOWED.has(key)) throw reject("CAMPUS_SYNC_BODY_REJECTED");
    if (typeof body[key] !== "string") throw reject("CAMPUS_SYNC_BODY_REJECTED");
  });
  const studentId = String(body.studentId || "").trim();
  const password = String(body.password || "");
  const semester = String(body.semester || "");
  const wxCode = String(body.wxCode || "").trim();
  if (!/^\d{6,20}$/.test(studentId) || !password) throw reject("INVALID_CREDENTIALS");
  if (password.length > 128) throw reject("CAMPUS_SYNC_BODY_REJECTED");
  if (semester && !/^[0-9A-Za-z._-]{1,32}$/.test(semester)) throw reject("CAMPUS_SYNC_BODY_REJECTED");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(wxCode)) throw reject("CAMPUS_SYNC_WECHAT_PROOF_INVALID");
  return { studentId, password, semester, wxCode };
}

module.exports = {
  assertJobBody,
};
