const crypto = require("crypto");
const config = require("../config");
const { maskStudentId, safeLog } = require("../utils/safeLogger");
const {
  clearPrivateKeyChallenge,
  createPreviewToken,
  deletePreview,
  getPreview,
  takePreview,
  takePrivateKeyChallenge,
} = require("./fosuApaasImportSessionStore");
const { assertImportAttemptAllowed } = require("./fosuApaasImportRateLimiter");
const { importSchedulePreview } = require("./fosuApaasImporter");

const ALLOWED_CONFIRM_MODES = new Set(["replace_fosu_source", "merge", "replace_all_personal"]);

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function fromBase64(value) {
  return Buffer.from(String(value || ""), "base64");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function decryptCredentialPayload(body = {}) {
  const keyRecord = takePrivateKeyChallenge(body.keyId);
  if (!keyRecord) {
    const error = new Error("IMPORT_KEY_EXPIRED");
    error.code = "IMPORT_KEY_EXPIRED";
    throw error;
  }

  try {
    const encryptedKey = fromBase64(body.encryptedKey);
    const encryptedPayload = fromBase64(body.encryptedPayload);
    const iv = fromBase64(body.iv);
    const tag = fromBase64(body.tag);
    if (!encryptedKey.length || !encryptedPayload.length || iv.length < 12 || tag.length !== 16) {
      const error = new Error("INVALID_ENCRYPTED_PAYLOAD");
      error.code = "INVALID_ENCRYPTED_PAYLOAD";
      throw error;
    }

    const aesKey = crypto.privateDecrypt({
      key: keyRecord.privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    }, encryptedKey);

    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encryptedPayload), decipher.final()]);
    const payload = safeJsonParse(decrypted.toString("utf8"));
    if (!payload || typeof payload !== "object") {
      const error = new Error("INVALID_ENCRYPTED_PAYLOAD");
      error.code = "INVALID_ENCRYPTED_PAYLOAD";
      throw error;
    }

    const studentId = toText(payload.studentId);
    const password = String(payload.password || "");
    const nonce = toText(payload.nonce);
    const timestamp = Number(payload.timestamp || 0);
    if (!studentId || !password || nonce !== keyRecord.nonce) {
      const error = new Error("INVALID_ENCRYPTED_PAYLOAD");
      error.code = "INVALID_ENCRYPTED_PAYLOAD";
      throw error;
    }
    if (!/^\d{6,20}$/.test(studentId)) {
      const error = new Error("INVALID_STUDENT_ID");
      error.code = "INVALID_STUDENT_ID";
      throw error;
    }
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
      const error = new Error("IMPORT_KEY_EXPIRED");
      error.code = "IMPORT_KEY_EXPIRED";
      throw error;
    }

    return {
      studentId,
      password,
      nonce,
      timestamp,
    };
  } finally {
    clearPrivateKeyChallenge(keyRecord);
  }
}

function getOwnerKey(req) {
  const session = req && req.fosuSession || {};
  return session.openidHash || session.sessionIdHash || session.sessionId || "";
}

function assertPreviewOwner(record, req) {
  const ownerKey = getOwnerKey(req);
  if (!record || !ownerKey || record.ownerKey !== ownerKey) {
    const error = new Error("IMPORT_TOKEN_EXPIRED");
    error.code = "IMPORT_TOKEN_EXPIRED";
    throw error;
  }
}

function publicPreviewPayload(preview, tokenInfo) {
  return {
    success: true,
    importPreviewToken: tokenInfo.token,
    expiresIn: tokenInfo.expiresIn,
    profile: preview.profile,
    summary: preview.summary,
    preview: preview.preview,
  };
}

async function createStudentSchedulePreview(req, encryptedBody) {
  if (String(config.FOSU_IMPORT_ENABLE) === "false") {
    const error = new Error("FOSU_IMPORT_DISABLED");
    error.code = "FOSU_IMPORT_DISABLED";
    throw error;
  }

  let credentials = null;
  const taskId = crypto.randomBytes(8).toString("hex");
  const startedAt = Date.now();
  try {
    credentials = decryptCredentialPayload(encryptedBody);
    const ownerKey = getOwnerKey(req);
    const ipInfo = req.clientIpInfo || {};
    assertImportAttemptAllowed({
      userKey: ownerKey,
      studentId: credentials.studentId,
      ip: ipInfo.effectiveIp || req.ip || "",
    });

    const preview = await importSchedulePreview(credentials.studentId, credentials.password, {
      semester: encryptedBody && encryptedBody.semester || "当前学期",
    });

    const tokenInfo = createPreviewToken({
      ownerKey,
      taskId,
      studentId: credentials.studentId,
      profile: preview.profile,
      summary: preview.summary,
      preview: preview.preview,
      scheduledCourses: preview.scheduledCourses,
      unscheduledCourses: preview.unscheduledCourses,
      source: "fosu_apaas",
    });

    safeLog("fosu-apaas-preview-success", {
      taskId,
      userKey: ownerKey ? `${ownerKey.slice(0, 8)}...` : "",
      studentId: maskStudentId(credentials.studentId),
      rawRowCount: preview.summary.rawRowCount,
      scheduledCourseCount: preview.summary.scheduledCourseCount,
      unscheduledCourseCount: preview.summary.unscheduledCourseCount,
      elapsedMs: Date.now() - startedAt,
    });

    return publicPreviewPayload(preview, tokenInfo);
  } catch (error) {
    safeLog("fosu-apaas-preview-failed", {
      taskId,
      code: error.code || error.message,
      studentId: credentials && maskStudentId(credentials.studentId),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    if (credentials) {
      credentials.password = null;
      credentials.nonce = null;
    }
  }
}

function courseDedupKey(course) {
  return [
    course && course.sourceStudentId || "",
    course && course.courseName || "",
    course && course.weekText || "",
    course && course.weekday || course && course.weekDay || "",
    course && course.sectionText || "",
    course && course.roomName || course && course.classroom || "",
    course && course.className || "",
    course && course.source || "",
  ].join("|");
}

function dedupeCourses(courses) {
  const seen = new Set();
  const result = [];
  (courses || []).forEach((course) => {
    const key = courseDedupKey(course);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(course);
  });
  return result;
}

function applyImportMode(existingCourses, importedCourses, mode) {
  const importMode = ALLOWED_CONFIRM_MODES.has(mode) ? mode : "replace_fosu_source";
  const existing = Array.isArray(existingCourses) ? existingCourses : [];
  const incoming = dedupeCourses(importedCourses || []);
  if (importMode === "replace_all_personal") {
    return incoming;
  }
  if (importMode === "merge") {
    return dedupeCourses(existing.concat(incoming));
  }
  return existing
    .filter((course) => course && course.source !== "fosu_apaas")
    .concat(incoming);
}

function buildConfirmedSchedule(record, mode, existingCourses = []) {
  const importedAt = new Date().toISOString();
  const incomingCourses = (record.scheduledCourses || []).map((course) => Object.assign({}, course, {
    importedAt,
    source: "fosu_apaas",
  }));
  const courses = applyImportMode(existingCourses, incomingCourses, mode);
  return {
    type: "personal-apaas",
    name: record.profile.studentName ? `${record.profile.studentName}的个人课表` : "个人课表",
    title: record.profile.studentName ? `${record.profile.studentName}的个人课表` : "个人课表",
    subtitle: [
      record.profile.className || "班级未确认",
      record.summary.semester || "当前学期",
      "APaaS导入",
    ].filter(Boolean).join(" · "),
    classId: `personal-apaas-${crypto.createHash("sha256").update(record.studentId || "").digest("hex").slice(0, 16)}`,
    semester: record.summary.semester || "当前学期",
    term: record.summary.semester || "当前学期",
    courses,
    unplacedCourses: record.unscheduledCourses || [],
    updateTime: importedAt.slice(0, 10),
    importedAt,
    sourceText: "佛山大学 APaaS 本科生学生课表",
    source: "fosu_apaas",
    sourceStudentId: record.studentId,
    metadata: {
      studentId: record.studentId,
      studentName: record.profile.studentName || "",
      className: record.profile.className || "",
      classNameConfidence: record.profile.classNameConfidence || "low",
      term: record.summary.semester || "",
      source: "fosu_apaas",
      rawRowCount: record.summary.rawRowCount,
      scheduledCourseCount: incomingCourses.length,
      totalCourseCount: courses.length,
      unscheduledCourseCount: (record.unscheduledCourses || []).length,
      conflictCount: record.summary.conflictCount || 0,
    },
  };
}

function confirmStudentScheduleImport(req, body = {}) {
  const token = toText(body.importPreviewToken);
  const mode = toText(body.mode) || "replace_fosu_source";
  if (!ALLOWED_CONFIRM_MODES.has(mode)) {
    const error = new Error("INVALID_IMPORT_MODE");
    error.code = "INVALID_IMPORT_MODE";
    throw error;
  }
  const record = takePreview(token);
  assertPreviewOwner(record, req);
  const existingCourses = Array.isArray(body.existingCourses) ? body.existingCourses.slice(0, 500) : [];
  const schedule = buildConfirmedSchedule(record, mode, existingCourses);
  const importedCourseCount = (record.scheduledCourses || []).length;
  safeLog("fosu-apaas-confirm-success", {
    taskId: record.taskId,
    userKey: record.ownerKey ? `${record.ownerKey.slice(0, 8)}...` : "",
    studentId: maskStudentId(record.studentId),
    importedCourseCount,
    totalCourseCount: schedule.courses.length,
    unscheduledCourseCount: schedule.unplacedCourses.length,
  });
  return {
    success: true,
    mode,
    importedCourseCount,
    totalCourseCount: schedule.courses.length,
    unscheduledCourseCount: schedule.unplacedCourses.length,
    conflictCount: record.summary.conflictCount || 0,
    schedule,
    courses: schedule.courses,
    unplacedCourses: schedule.unplacedCourses,
    profile: record.profile,
    summary: record.summary,
  };
}

function cancelStudentScheduleImport(req, body = {}) {
  const token = toText(body.importPreviewToken);
  const record = getPreview(token);
  if (record) {
    assertPreviewOwner(record, req);
  }
  deletePreview(token);
  return { success: true, canceled: true };
}

module.exports = {
  ALLOWED_CONFIRM_MODES,
  applyImportMode,
  cancelStudentScheduleImport,
  confirmStudentScheduleImport,
  createStudentSchedulePreview,
  decryptCredentialPayload,
};
