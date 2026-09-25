const iconv = require("iconv-lite");
const { decodeSchoolHtml, detectCharset: detectSchoolCharset } = require("../../../miniprogram/services/schoolHtmlCharset");
const config = require("../config");
const { safeLog } = require("../utils/safeLogger");
const { assertImportAttemptAllowed } = require("./studentScheduleImportRateLimiter");
const { parsePersonalScheduleHtml, parsePersonalSchedulePageMetadata } = require("../utils/personal-schedule-parser");
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
  return detectSchoolCharset(contentType, buffer);
}

function decodeTimetable(buffer, contentType) {
  return decodeSchoolHtml(buffer, contentType, iconv);
}

function sanitizePlain(value, max) {
  const text = String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/script|javascript:|onerror\s*=/i.test(text)) return "";
  return text.slice(0, max);
}

function sanitizeProfileHint(hint) {
  const source = hint && typeof hint === "object" ? hint : {};
  const status = ["ok", "partial", "unavailable", "id_mismatch"].indexOf(source.profileStatus) >= 0
    ? source.profileStatus
    : "";
  const masked = sanitizePlain(source.studentIdMasked, 32).replace(/[^\d*]/g, "");
  return {
    studentName: sanitizePlain(source.studentName, 40),
    className: sanitizePlain(source.className, 80),
    studentIdMasked: masked,
    studentIdMatched: source.studentIdMatched === true,
    source: sanitizePlain(source.source, 32),
    profileStatus: status,
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

function createTimetablePreview(req, body, source) {
  if (String(config.FOSU_IMPORT_ENABLE) === "false") throw previewError("FOSU_IMPORT_DISABLED");
  const session = req && req.fosuSession || {};
  const ipInfo = req && req.clientIpInfo || {};
  assertImportAttemptAllowed({
    userKey: session.openidHash || session.sessionIdHash || "",
    ip: ipInfo.effectiveIp || (req && req.ip) || "",
  });
  const payload = body || {};
  rejectSecretKeys(payload);
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
  const pageMetadata = parsePersonalSchedulePageMetadata(decoded.html);
  const courses = parsePersonalScheduleHtml(decoded.html, {
    semester: payload.semester || "",
    source: "personal-xskb",
  });
  if (!courses.length) throw previewError("SCHEDULE_ROWS_EMPTY");
  const channel = source === "campus-agent" ? "campus-agent" : "client-direct";
  const preview = createNormalizedPreviewFromImportedData(coursesToRawRows(courses), {
    semester: payload.semester || "当前学期",
    scheduleOwnership: "personal",
    reliableClassScope: false,
    source: channel,
    timing: {
      channel,
      bytesApprox: buffer.length,
      rowsCount: courses.length,
    },
  });
  const profileHint = sanitizeProfileHint(payload.profileHint);
  if (preview.profile) {
    preview.profile.studentName = profileHint.studentName || pageMetadata.studentName || "";
    preview.profile.className = profileHint.className || "";
    preview.profile.targetClassName = "";
    preview.profile.classNameConfidence = profileHint.className ? "high" : "none";
    if (profileHint.studentIdMasked) preview.profile.studentIdMasked = profileHint.studentIdMasked;
  }
  preview.pageRemarks = pageMetadata.pageRemarks;
  const profileStatus = profileHint.profileStatus || (preview.profile && preview.profile.studentName ? "ok" : "unavailable");
  safeLog("fosu-direct-preview-profile", { code: profileStatus === "unavailable" ? "PROFILE_NAME_MISSING" : profileStatus });
  safeLog("fosu-direct-preview-ok", {
    code: "OK",
    bytes: buffer.length,
    charset: decoded.charset,
    courseCount: courses.length,
    channel,
  });
  return createStoredPreviewFromNormalized(req, preview, { source: channel });
}

function createDirectStudentSchedulePreview(req, body) {
  if (body && body.source !== "client-direct-fosu100") throw previewError("INVALID_IMPORT_MODE");
  return createTimetablePreview(req, body, "client-direct");
}

function createCampusAgentStudentSchedulePreview(req, body) {
  return createTimetablePreview(req, body, "campus-agent");
}

module.exports = {
  createCampusAgentStudentSchedulePreview,
  createDirectStudentSchedulePreview,
  detectCharset,
  rejectSecretKeys,
  sanitizeProfileHint,
};
