const iconv = require("iconv-lite");
const config = require("../config");
const { safeLog } = require("../utils/safeLogger");
const { assertImportAttemptAllowed } = require("./studentScheduleImportRateLimiter");
const { parsePersonalScheduleHtml } = require("../utils/personal-schedule-parser");
const { createNormalizedPreviewFromImportedData } = require("./scheduleImportNormalizer");
const { createStoredPreviewFromNormalized } = require("./studentScheduleImportService");

const MAX_TIMETABLE_BYTES = 1200000;
const MAX_BASE64_CHARS = 1700000;
const SECRET_KEY_PATTERN = /^(password|encryptedpassword|cookie|cookies|castgc|jsessionid|ticket|execution|pwdencryptsalt|set-cookie|authorization)$/i;

function previewError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function rejectSecretKeys(value, path) {
  if (!value || typeof value !== "object") return;
  Object.keys(value).forEach((key) => {
    if (SECRET_KEY_PATTERN.test(key) || /^studentid$/i.test(key)) {
      safeLog("fosu-direct-preview-rejected", { code: "DIRECT_SECRET_REJECTED" });
      throw previewError("DIRECT_SECRET_REJECTED");
    }
    rejectSecretKeys(value[key], path);
  });
}

function detectCharset(contentType, buffer) {
  const header = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(String(contentType || ""));
  if (header) return header[1].toLowerCase();
  const sniff = buffer.slice(0, 1200).toString("latin1");
  const meta = /charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i.exec(sniff);
  return meta ? meta[1].toLowerCase() : "utf-8";
}

function decodeTimetable(buffer, contentType) {
  const charset = detectCharset(contentType, buffer);
  const encoding = /gb2312|gbk|gb18030/.test(charset) ? "gbk" : "utf8";
  return {
    html: iconv.decode(buffer, encoding),
    charset: encoding,
  };
}

function coursesToRawRows(courses) {
  return (courses || []).map((course) => ({
    courseName: course.courseName || "",
    weekText: course.weekText || "",
    weeks: course.weeks || [],
    weekday: course.weekday || course.weekDay || "",
    weekdayText: String(course.weekday || course.weekDay || ""),
    sections: course.sections || [],
    sectionText: course.sectionText || "",
    roomName: course.roomName || course.classroom || "",
    classroom: course.classroom || course.roomName || "",
    teacherName: course.teacherName || "",
    className: course.className || course.classNameRaw || "",
    specialNote: course.note || course.specialNote || "",
    studentName: course.studentName || "",
  }));
}

function createDirectStudentSchedulePreview(req, body) {
  if (String(config.FOSU_IMPORT_ENABLE) === "false") throw previewError("FOSU_IMPORT_DISABLED");
  const session = req && req.fosuSession || {};
  const ipInfo = req && req.clientIpInfo || {};
  assertImportAttemptAllowed({
    userKey: session.openidHash || session.sessionIdHash || "",
    ip: ipInfo.effectiveIp || (req && req.ip) || "",
  });
  const payload = body || {};
  rejectSecretKeys(payload);
  if (payload.source !== "client-direct-fosu100") throw previewError("INVALID_IMPORT_MODE");
  const encoded = String(payload.timetableBodyBase64 || "");
  if (!encoded || encoded.length > MAX_BASE64_CHARS) throw previewError("DIRECT_BODY_TOO_LARGE");
  let buffer;
  try {
    buffer = Buffer.from(encoded, "base64");
  } catch (error) {
    throw previewError("DIRECT_BODY_INVALID");
  }
  if (!buffer.length || buffer.length > MAX_TIMETABLE_BYTES) throw previewError("DIRECT_BODY_TOO_LARGE");
  const decoded = decodeTimetable(buffer, payload.contentType);
  if (/name=["']username["']/i.test(decoded.html) && /name=["']password["']/i.test(decoded.html)) {
    throw previewError("DIRECT_PAYLOAD_NOT_TIMETABLE");
  }
  const courses = parsePersonalScheduleHtml(decoded.html, {
    semester: payload.semester || "",
    source: "personal-xskb",
  });
  if (!courses.length) throw previewError("SCHEDULE_ROWS_EMPTY");
  const preview = createNormalizedPreviewFromImportedData(coursesToRawRows(courses), {
    semester: payload.semester || "当前学期",
    scheduleOwnership: "personal",
    source: "client-direct",
    timing: {
      channel: "client-direct",
      bytesApprox: buffer.length,
      rowsCount: courses.length,
    },
  });
  const profileHint = payload.profileHint || {};
  if (profileHint.studentIdMasked && preview.profile) {
    preview.profile.studentIdMasked = String(profileHint.studentIdMasked);
  }
  safeLog("fosu-direct-preview-ok", {
    code: "OK",
    bytes: buffer.length,
    charset: decoded.charset,
    courseCount: courses.length,
  });
  return createStoredPreviewFromNormalized(req, preview, { source: "client-direct" });
}

module.exports = {
  createDirectStudentSchedulePreview,
  detectCharset,
  rejectSecretKeys,
};
