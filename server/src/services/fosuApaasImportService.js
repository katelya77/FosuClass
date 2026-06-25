const crypto = require("crypto");
const { sm2 } = require("sm-crypto");
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
const {
  assertImportAttemptAllowed,
  recordImportFailure,
} = require("./fosuApaasImportRateLimiter");
const { importSchedulePreview } = require("./fosuApaasImporter");
const { IMPORT_DECISION, toImportCourse } = require("./scheduleImportNormalizer");
const { parseSections, parseWeeks } = require("../utils/fosuApaasScheduleParser");

const ALLOWED_CONFIRM_MODES = new Set(["replace_fosu_source", "merge", "replace_all_personal"]);
const PREVIEW_JOB_TTL_MS = Math.max(2 * 60 * 1000, Number(process.env.FOSU_IMPORT_PREVIEW_JOB_TTL_SECONDS || 10 * 60) * 1000 || 10 * 60 * 1000);
const previewJobs = new Map();

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

function importPayloadError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function previewJobError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeCredentialAlgorithm(value) {
  const text = toText(value).toUpperCase();
  if (!text) return "RSA-OAEP";
  if (text === "SM2" || text === "SM2-C1C3C2") return "SM2";
  if (text === "RSA-OAEP" || text === "RSA-OAEP-256/AES-256-GCM") return "RSA-OAEP";
  return text;
}

function validateCredentialPayload(payload, keyRecord) {
  if (!payload || typeof payload !== "object") {
    throw importPayloadError("INVALID_ENCRYPTED_PAYLOAD");
  }

  const studentId = toText(payload.studentId);
  const password = String(payload.password || "");
  const nonce = toText(payload.nonce);
  const timestamp = Number(payload.timestamp || 0);
  if (!studentId || !password || nonce !== keyRecord.nonce) {
    throw importPayloadError("INVALID_ENCRYPTED_PAYLOAD");
  }
  if (!/^\d{6,20}$/.test(studentId)) {
    throw importPayloadError("INVALID_STUDENT_ID");
  }
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    throw importPayloadError("IMPORT_KEY_EXPIRED");
  }

  return {
    studentId,
    password,
    nonce,
    timestamp,
  };
}

function decryptRsaHybridCredentialPayload(body, keyRecord) {
  const encryptedKey = fromBase64(body.encryptedKey);
  const encryptedPayload = fromBase64(body.encryptedPayload);
  const iv = fromBase64(body.iv);
  const tag = fromBase64(body.tag);
  if (!encryptedKey.length || !encryptedPayload.length || iv.length < 12 || tag.length !== 16) {
    throw importPayloadError("INVALID_ENCRYPTED_PAYLOAD");
  }

  const aesKey = crypto.privateDecrypt({
    key: keyRecord.rsaPrivateKey || keyRecord.privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, encryptedKey);

  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encryptedPayload), decipher.final()]);
  return safeJsonParse(decrypted.toString("utf8"));
}

function decryptSm2CredentialPayload(body, keyRecord) {
  const encryptedPayload = toText(body.encryptedPayload || body.ciphertext);
  if (!encryptedPayload || !/^[0-9a-f]+$/i.test(encryptedPayload) || !keyRecord.sm2PrivateKey) {
    throw importPayloadError("INVALID_ENCRYPTED_PAYLOAD");
  }
  const decrypted = sm2.doDecrypt(encryptedPayload, keyRecord.sm2PrivateKey, 1);
  return safeJsonParse(decrypted);
}

function decryptCredentialPayload(body = {}) {
  const keyRecord = takePrivateKeyChallenge(body.keyId);
  if (!keyRecord) {
    throw importPayloadError("IMPORT_KEY_EXPIRED");
  }

  try {
    const algorithm = normalizeCredentialAlgorithm(body.algorithm);
    if (algorithm === "SM2") {
      return validateCredentialPayload(decryptSm2CredentialPayload(body, keyRecord), keyRecord);
    }
    if (algorithm === "RSA-OAEP") {
      return validateCredentialPayload(decryptRsaHybridCredentialPayload(body, keyRecord), keyRecord);
    }
    throw importPayloadError("INVALID_ENCRYPTED_PAYLOAD");
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
  const profile = Object.assign({}, preview.profile || {});
  profile.studentIdMasked = maskStudentId(profile.studentId || "");
  return {
    success: true,
    importPreviewToken: tokenInfo.token,
    expiresIn: tokenInfo.expiresIn,
    profile,
    summary: preview.summary,
    previewGrid: preview.previewGrid,
    buckets: preview.buckets,
    groups: preview.groups,
    uiHints: preview.uiHints,
    preview: preview.preview,
    timing: preview.timing,
  };
}

function cleanupPreviewJobs(now = Date.now()) {
  for (const [jobId, record] of previewJobs.entries()) {
    if (!record || Number(record.expiresAtMs || 0) <= now) {
      previewJobs.delete(jobId);
    }
  }
}

function createPreviewJobId() {
  return `fosu_preview_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function safeJobTiming(timing) {
  const source = timing || {};
  return {
    channel: source.channel || "",
    fallbackReason: source.fallbackReason || "",
    retryCount: Number(source.retryCount || 0) || 0,
    decryptMs: Number(source.decryptMs || 0) || 0,
    loginMs: Number(source.loginMs || 0) || 0,
    discoverMs: Number(source.discoverMs || source.discoverAppMs || 0) || 0,
    fetchRowsMs: Number(source.fetchRowsMs || 0) || 0,
    normalizeMs: Number(source.normalizeMs || 0) || 0,
    totalMs: Number(source.totalMs || 0) || 0,
  };
}

function publicPreviewJob(record) {
  const payload = {
    success: record.status !== "failed",
    jobId: record.jobId,
    status: record.status,
    progress: Math.max(0, Math.min(100, Number(record.progress || 0) || 0)),
    step: record.step || "",
    message: record.message || "",
    timing: safeJobTiming(record.timing),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (record.status === "success" && record.result) {
    payload.result = record.result;
    Object.assign(payload, record.result);
  }
  if (record.status === "failed" && record.error) {
    payload.error = record.error;
    payload.code = record.error.code || record.error.message || "UNKNOWN_IMPORT_ERROR";
    payload.retryAfter = record.error.retryAfterSeconds || 0;
  }
  return payload;
}

function updatePreviewJob(jobId, patch = {}) {
  const record = previewJobs.get(jobId);
  if (!record) return null;
  Object.assign(record, patch, {
    updatedAt: new Date().toISOString(),
  });
  previewJobs.set(jobId, record);
  return record;
}

function createPreviewJobRecord(context) {
  cleanupPreviewJobs();
  const now = new Date().toISOString();
  const jobId = createPreviewJobId();
  const record = {
    jobId,
    taskId: context.taskId,
    ownerKey: context.ownerKey,
    studentIdMasked: maskStudentId(context.credentials && context.credentials.studentId),
    status: "pending",
    progress: 8,
    step: "queued",
    message: "已创建读取任务，正在准备连接学校系统。",
    timing: { decryptMs: context.decryptMs || 0 },
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    expiresAtMs: Date.now() + PREVIEW_JOB_TTL_MS,
  };
  previewJobs.set(jobId, record);
  return record;
}

function getStudentSchedulePreviewJobStatus(req, jobId) {
  cleanupPreviewJobs();
  const id = toText(jobId);
  const record = id ? previewJobs.get(id) : null;
  if (!record) {
    throw previewJobError("IMPORT_PREVIEW_JOB_NOT_FOUND");
  }
  if (record.ownerKey !== getOwnerKey(req)) {
    throw previewJobError("IMPORT_PREVIEW_JOB_NOT_FOUND");
  }
  return publicPreviewJob(record);
}

function getPreviewRequestOptions(encryptedBody = {}) {
  return {
    semester: encryptedBody.semester || "\u5f53\u524d\u5b66\u671f",
    existingSelectedClassName: encryptedBody && (encryptedBody.selectedClassName || encryptedBody.currentClassName) || "",
  };
}

function prepareStudentSchedulePreview(req, encryptedBody = {}) {
  if (String(config.FOSU_IMPORT_ENABLE) === "false") {
    const error = new Error("FOSU_IMPORT_DISABLED");
    error.code = "FOSU_IMPORT_DISABLED";
    throw error;
  }

  let credentials = null;
  const taskId = crypto.randomBytes(8).toString("hex");
  const startedAt = Date.now();
  let decryptMs = 0;
  try {
    const decryptStartedAt = Date.now();
    credentials = decryptCredentialPayload(encryptedBody);
    decryptMs = Date.now() - decryptStartedAt;
    const ownerKey = getOwnerKey(req);
    const ipInfo = req.clientIpInfo || {};
    assertImportAttemptAllowed({
      userKey: ownerKey,
      studentId: credentials.studentId,
      ip: ipInfo.effectiveIp || req.ip || "",
    });
    return {
      credentials,
      ownerKey,
      ipInfo,
      reqIp: req.ip || "",
      taskId,
      startedAt,
      decryptMs,
      options: getPreviewRequestOptions(encryptedBody),
    };
  } catch (error) {
    if (credentials) {
      credentials.password = null;
      credentials.nonce = null;
    }
    safeLog("fosu-apaas-preview-prepare-failed", {
      taskId,
      code: error.code || error.message,
      studentId: credentials && maskStudentId(credentials.studentId),
      decryptMs,
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
}

async function runPreparedStudentSchedulePreview(context, progress) {
  const credentials = context.credentials;
  const taskId = context.taskId;
  const startedAt = context.startedAt || Date.now();
  const ownerKey = context.ownerKey || "";
  const ipInfo = context.ipInfo || {};
  const reportProgress = typeof progress === "function" ? progress : () => {};
  try {
    reportProgress({
      status: "running",
      progress: 22,
      step: "login",
      message: "正在登录学校系统并验证会话。",
      timing: { decryptMs: context.decryptMs || 0 },
    });
    const preview = await importSchedulePreview(credentials.studentId, credentials.password, {
      semester: context.options.semester,
      existingSelectedClassName: context.options.existingSelectedClassName,
    });
    reportProgress({
      status: "running",
      progress: 86,
      step: "normalize",
      message: "已读取课表，正在整理预览结果。",
      timing: Object.assign({ decryptMs: context.decryptMs || 0 }, preview.timing || {}),
    });

    const tokenInfo = createPreviewToken({
      ownerKey,
      taskId,
      studentId: credentials.studentId,
      profile: preview.profile,
      summary: preview.summary,
      preview: preview.preview,
      previewGrid: preview.previewGrid,
      buckets: preview.buckets,
      groups: preview.groups,
      courseGroups: preview.courseGroups,
      allArrangements: preview.allArrangements,
      defaultSelectedArrangementIds: preview.defaultSelectedArrangementIds,
      scheduledCourses: preview.scheduledCourses,
      unscheduledCourses: preview.unscheduledCourses,
      timing: preview.timing,
      source: "fosu_apaas",
    });

    const payload = publicPreviewPayload(preview, tokenInfo);
    safeLog("fosu-apaas-preview-success", {
      taskId,
      userKey: ownerKey ? `${ownerKey.slice(0, 8)}...` : "",
      studentId: maskStudentId(credentials.studentId),
      rawRowCount: preview.summary.rawRowCount,
      scheduledCourseCount: preview.summary.scheduledCourseCount,
      unscheduledCourseCount: preview.summary.unscheduledCourseCount,
      channel: preview.timing && preview.timing.channel,
      loginMs: preview.timing && preview.timing.loginMs,
      discoverMs: preview.timing && preview.timing.discoverMs,
      fetchRowsMs: preview.timing && preview.timing.fetchRowsMs,
      normalizeMs: preview.timing && preview.timing.normalizeMs,
      totalMs: preview.timing && preview.timing.totalMs,
      retryCount: preview.timing && preview.timing.retryCount,
      decryptMs: context.decryptMs || 0,
      elapsedMs: Date.now() - startedAt,
    });

    return payload;
  } catch (error) {
    if (credentials) {
      recordImportFailure({
        userKey: ownerKey,
        studentId: credentials.studentId,
        ip: ipInfo.effectiveIp || context.reqIp || "",
      }, error.code || error.message);
    }
    safeLog("fosu-apaas-preview-failed", {
      taskId,
      code: error.code || error.message,
      studentId: credentials && maskStudentId(credentials.studentId),
      decryptMs: context.decryptMs || 0,
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

async function createStudentSchedulePreview(req, encryptedBody) {
  const context = prepareStudentSchedulePreview(req, encryptedBody);
  return runPreparedStudentSchedulePreview(context);
}

function startStudentSchedulePreviewJob(req, encryptedBody) {
  const context = prepareStudentSchedulePreview(req, encryptedBody);
  const record = createPreviewJobRecord(context);
  const jobId = record.jobId;

  setTimeout(() => {
    runPreparedStudentSchedulePreview(context, (patch) => {
      const current = previewJobs.get(jobId);
      const timing = Object.assign({}, current && current.timing || {}, patch.timing || {});
      updatePreviewJob(jobId, Object.assign({}, patch, { timing }));
    })
      .then((payload) => {
        updatePreviewJob(jobId, {
          status: "success",
          progress: 100,
          step: "success",
          message: "课表读取成功。",
          result: payload,
          timing: Object.assign({}, previewJobs.get(jobId) && previewJobs.get(jobId).timing || {}, payload.timing || {}),
        });
      })
      .catch((error) => {
        const current = previewJobs.get(jobId);
        updatePreviewJob(jobId, {
          status: "failed",
          progress: Math.max(Number(current && current.progress || 0) || 0, 100),
          step: "failed",
          message: error.code || error.message || "UNKNOWN_IMPORT_ERROR",
          error: {
            code: error.code || error.message || "UNKNOWN_IMPORT_ERROR",
            message: error.message || "",
            kind: error.kind || "",
            retryAfterSeconds: error.retryAfterSeconds || 0,
          },
          timing: Object.assign({}, current && current.timing || {}, {
            totalMs: Date.now() - context.startedAt,
          }),
        });
      });
  }, 0);

  safeLog("fosu-apaas-preview-job-started", {
    taskId: context.taskId,
    jobId,
    userKey: context.ownerKey ? `${context.ownerKey.slice(0, 8)}...` : "",
    studentId: maskStudentId(context.credentials.studentId),
    decryptMs: context.decryptMs,
  });

  return publicPreviewJob(record);
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

function selectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getArrangementMap(record) {
  const map = new Map();
  (record && record.allArrangements || []).forEach((arrangement) => {
    if (arrangement && arrangement.arrangementId) {
      map.set(String(arrangement.arrangementId), arrangement);
    }
  });
  return map;
}

function sanitizeEditableText(value, maxLength = 80) {
  return toText(value)
    .replace(/[<>{}`$\\]/g, "")
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, maxLength);
}

function parseEditedSections(edited) {
  if (Array.isArray(edited.sections)) {
    return edited.sections.map(Number).filter((item) => Number.isInteger(item));
  }
  const start = Number(edited.startSection || 0);
  const end = Number(edited.endSection || start || 0);
  if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return parseSections(edited.sectionText || "");
}

function parseEditedWeeks(edited) {
  if (Array.isArray(edited.weeks)) {
    return edited.weeks.map(Number).filter((item) => Number.isInteger(item));
  }
  return parseWeeks(edited.weekText || "");
}

function validateEditedArrangement(base, edited) {
  const weekday = Number(edited.weekday || edited.weekDay || 0);
  const sections = parseEditedSections(edited);
  const weeks = parseEditedWeeks(edited);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw selectionError("INVALID_EDITED_ARRANGEMENT");
  }
  if (!sections.length || sections.some((item) => item < 1 || item > 14)) {
    throw selectionError("INVALID_EDITED_ARRANGEMENT");
  }
  if (!weeks.length || weeks.some((item) => item < 1 || item > 60)) {
    throw selectionError("INVALID_EDITED_ARRANGEMENT");
  }
  const sortedSections = Array.from(new Set(sections)).sort((left, right) => left - right);
  const sortedWeeks = Array.from(new Set(weeks)).sort((left, right) => left - right);
  const roomName = sanitizeEditableText(edited.roomName || edited.classroom || base.roomName || "");
  const weekText = sanitizeEditableText(edited.weekText || sortedWeeks.join(","));
  const sectionText = sanitizeEditableText(edited.sectionText || `${sortedSections[0]}-${sortedSections[sortedSections.length - 1]}`);
  const arrangementId = `arr_edit_${crypto.createHash("sha256").update(JSON.stringify({
    base: base.arrangementId,
    weekday,
    sections: sortedSections,
    weeks: sortedWeeks,
    roomName,
  })).digest("hex").slice(0, 22)}`;
  return Object.assign({}, base, {
    arrangementId,
    weekday,
    sections: sortedSections,
    startSection: sortedSections[0],
    endSection: sortedSections[sortedSections.length - 1],
    weeks: sortedWeeks,
    weekText,
    sectionText,
    roomName,
    hasCompleteTime: true,
    importDecision: IMPORT_DECISION.AUTO_INCLUDE,
    reason: "已手动确认，加入导入",
    selectedByDefault: true,
  });
}

function buildSelectedImportCourses(record, body = {}, importedAt) {
  const arrangementMap = getArrangementMap(record);
  if (!arrangementMap.size) {
    return {
      incomingCourses: record.scheduledCourses || [],
      selectedArrangementIds: [],
      unplacedCourses: record.unscheduledCourses || [],
    };
  }

  const explicitSelection = Object.prototype.hasOwnProperty.call(body, "selectedArrangementIds");
  const selectedArrangementIds = explicitSelection
    ? (Array.isArray(body.selectedArrangementIds) ? body.selectedArrangementIds.map(toText).filter(Boolean) : [])
    : (record.defaultSelectedArrangementIds || []);
  const selectedSet = new Set(selectedArrangementIds);
  selectedSet.forEach((id) => {
    if (!arrangementMap.has(id)) {
      throw selectionError("INVALID_SELECTED_ARRANGEMENT");
    }
  });

  const editedByBaseId = new Map();
  const editedArrangements = Array.isArray(body.editedArrangements) ? body.editedArrangements.slice(0, 100) : [];
  editedArrangements.forEach((edited) => {
    const baseId = toText(edited && (edited.baseArrangementId || edited.arrangementId));
    const base = arrangementMap.get(baseId);
    if (!base) throw selectionError("INVALID_EDITED_ARRANGEMENT");
    editedByBaseId.set(baseId, validateEditedArrangement(base, edited || {}));
  });

  const incomingCourses = [];
  selectedSet.forEach((id) => {
    const arrangement = editedByBaseId.get(id) || arrangementMap.get(id);
    if (!arrangement || !arrangement.hasCompleteTime) {
      throw selectionError("INVALID_SELECTED_ARRANGEMENT");
    }
    incomingCourses.push(toImportCourse(arrangement, {
      studentId: record.studentId,
      semester: record.summary && record.summary.semester,
      importedAt,
      targetClassName: record.profile && (record.profile.targetClassName || record.profile.className),
    }));
  });

  const unplacedCourses = (record.allArrangements || [])
    .filter((arrangement) => !selectedSet.has(arrangement.arrangementId))
    .filter((arrangement) => !arrangement.hasCompleteTime || arrangement.importDecision !== IMPORT_DECISION.AUTO_INCLUDE)
    .map((arrangement) => Object.assign(toImportCourse(Object.assign({}, arrangement, {
      weekday: arrangement.weekday || null,
      sections: arrangement.sections || [],
      startSection: arrangement.startSection || null,
      endSection: arrangement.endSection || null,
    }), {
      studentId: record.studentId,
      semester: record.summary && record.summary.semester,
      importedAt,
      targetClassName: record.profile && (record.profile.targetClassName || record.profile.className),
    }), {
      isScheduled: false,
      reason: arrangement.reason || "",
    }));

  return { incomingCourses, selectedArrangementIds: Array.from(selectedSet), unplacedCourses };
}

function buildConfirmedSchedule(record, mode, existingCourses = [], selectedOptions = {}) {
  const importedAt = new Date().toISOString();
  const studentIdMasked = maskStudentId(record.studentId || "");
  const sourceCourses = selectedOptions.incomingCourses || record.scheduledCourses || [];
  const incomingCourses = sourceCourses.map((course) => Object.assign({}, course, {
    importedAt,
    source: "fosu_apaas",
    sourceStudentId: studentIdMasked,
  }));
  const courses = applyImportMode(existingCourses, incomingCourses, mode);
  const unplacedCourses = (selectedOptions.unplacedCourses || record.unscheduledCourses || []).map((course) => Object.assign({}, course, {
    sourceStudentId: studentIdMasked,
  }));
  return {
    type: "personal-apaas",
    name: record.profile.studentName ? `${record.profile.studentName}的个人课表` : "个人课表",
    title: record.profile.studentName ? `${record.profile.studentName}的个人课表` : "个人课表",
    subtitle: [
      record.profile.className || "班级未确认",
      record.summary.semester || "当前学期",
      "学号导入",
    ].filter(Boolean).join(" · "),
    classId: `personal-apaas-${crypto.createHash("sha256").update(record.studentId || "").digest("hex").slice(0, 16)}`,
    semester: record.summary.semester || "当前学期",
    term: record.summary.semester || "当前学期",
    courses,
    unplacedCourses,
    updateTime: importedAt.slice(0, 10),
    importedAt,
    sourceText: "学校课表系统",
    source: "fosu_apaas",
    sourceStudentId: studentIdMasked,
    metadata: {
      studentId: studentIdMasked,
      studentIdMasked,
      studentName: record.profile.studentName || "",
      className: record.profile.className || "",
      classNameConfidence: record.profile.classNameConfidence || "low",
      term: record.summary.semester || "",
      source: "fosu_apaas",
      rawRowCount: record.summary.rawRowCount,
      scheduledCourseCount: incomingCourses.length,
      totalCourseCount: courses.length,
      unscheduledCourseCount: unplacedCourses.length,
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
  const selection = buildSelectedImportCourses(record, body, new Date().toISOString());
  const schedule = buildConfirmedSchedule(record, mode, existingCourses, selection);
  const importedCourseCount = selection.incomingCourses.length;
  const studentIdMasked = maskStudentId(record.studentId || record.profile && record.profile.studentId || "");
  const publicProfile = Object.assign({}, record.profile || {}, {
    studentId: studentIdMasked,
    studentIdMasked,
  });
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
    selectedArrangementIds: selection.selectedArrangementIds,
    totalCourseCount: schedule.courses.length,
    unscheduledCourseCount: schedule.unplacedCourses.length,
    conflictCount: record.summary.conflictCount || 0,
    schedule,
    courses: schedule.courses,
    unplacedCourses: schedule.unplacedCourses,
    profile: publicProfile,
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
  getStudentSchedulePreviewJobStatus,
  startStudentSchedulePreviewJob,
};
