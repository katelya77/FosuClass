const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const RELAY_DIR = process.env.RELAY_DIR
  ? path.resolve(process.env.RELAY_DIR)
  : path.join(STORAGE_DIR, "relay");
const PAYLOAD_DIR = path.join(RELAY_DIR, "uploads");
const TASKS_PATH = path.join(RELAY_DIR, "tasks.json");
const UPLOADS_PATH = path.join(RELAY_DIR, "uploads.json");

const SECRET_KEY_PATTERN = /(studentId|student_id|password|passwd|pwd|cookie|ticket|execution|session|token|authorization|jsessionid|captcha)/i;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureRelayStorage() {
  ensureDir(RELAY_DIR);
  ensureDir(PAYLOAD_DIR);
}

function readJsonFile(filePath, fallback) {
  ensureRelayStorage();
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed == null ? fallback : parsed;
  } catch (error) {
    safeLog("relay-read-json-failed", { filePath, error: error.message });
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tmpPath); } catch (cleanupError) {}
  }
}

function readTasks() {
  const tasks = readJsonFile(TASKS_PATH, []);
  return Array.isArray(tasks) ? tasks : [];
}

function writeTasks(tasks) {
  writeJsonAtomic(TASKS_PATH, tasks);
}

function readUploads() {
  const uploads = readJsonFile(UPLOADS_PATH, []);
  return Array.isArray(uploads) ? uploads : [];
}

function writeUploads(uploads) {
  writeJsonAtomic(UPLOADS_PATH, uploads);
}

function normalizeString(value, fallback) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text || (fallback || "");
}

function toPositiveInteger(value, fallback, max) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.min(num, max || num);
}

function addHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function safeTaskForAgent(task) {
  return {
    id: task.id,
    term: task.term,
    description: task.description,
    expiresAt: task.expiresAt,
    maxUploads: task.maxUploads,
    uploadCount: task.uploadCount || 0,
    status: getTaskStatus(task),
    createdAt: task.createdAt,
    revokedAt: task.revokedAt || null,
  };
}

function getTaskStatus(task) {
  if (!task) return "not-found";
  if (task.revokedAt) return "revoked";
  if (task.expiresAt && new Date(task.expiresAt).getTime() <= Date.now()) return "expired";
  if (task.status === "published") return "published";
  if (task.status === "pending-review") return "pending-review";
  if ((task.uploadCount || 0) > 0) return "uploaded";
  if (task.startedAt) return "running";
  return task.status || "pending";
}

function createTask(input) {
  ensureRelayStorage();
  const now = new Date().toISOString();
  const expiresInHours = toPositiveInteger(input.expiresInHours, 24, 24 * 30);
  const task = {
    id: `relay_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    relayToken: crypto.randomBytes(32).toString("hex"),
    term: normalizeString(input.term, "2026-2027-1"),
    description: normalizeString(input.description, "全校课表接力采集"),
    expiresAt: normalizeString(input.expiresAt) || addHours(expiresInHours),
    maxUploads: toPositiveInteger(input.maxUploads, 1, 20),
    uploadCount: 0,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  const tasks = readTasks();
  tasks.unshift(task);
  writeTasks(tasks.slice(0, 500));
  return task;
}

function listTasks() {
  return readTasks().map((task) => Object.assign({}, task, {
    status: getTaskStatus(task),
  }));
}

function findTaskById(id) {
  return readTasks().find((task) => task.id === id) || null;
}

function findTaskByToken(token) {
  const relayToken = normalizeString(token);
  if (!relayToken) return null;
  return readTasks().find((task) => task.relayToken === relayToken) || null;
}

function updateTask(id, updater) {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return null;
  const next = Object.assign({}, tasks[index]);
  updater(next);
  next.updatedAt = new Date().toISOString();
  tasks[index] = next;
  writeTasks(tasks);
  return next;
}

function revokeTask(id) {
  return updateTask(id, (task) => {
    task.revokedAt = new Date().toISOString();
    task.status = "revoked";
  });
}

function deleteTask(id) {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return false;
  tasks.splice(index, 1);
  writeTasks(tasks);
  return true;
}

function validateTokenForUpload(token) {
  const task = findTaskByToken(token);
  if (!task) {
    const error = new Error("接力任务不存在或 token 无效");
    error.statusCode = 404;
    throw error;
  }
  const status = getTaskStatus(task);
  if (status === "revoked") {
    const error = new Error("接力任务已被吊销");
    error.statusCode = 403;
    throw error;
  }
  if (status === "expired") {
    const error = new Error("接力任务已过期");
    error.statusCode = 403;
    throw error;
  }
  if ((task.uploadCount || 0) >= task.maxUploads) {
    const error = new Error("接力任务上传次数已用完");
    error.statusCode = 403;
    throw error;
  }
  return task;
}

function normalizeStagingData(rawData, extra) {
  const data = Object.assign({}, rawData || {});
  if (!data.classSchedules && data.resources && Array.isArray(data.resources.classSchedules)) {
    data.classSchedules = data.resources.classSchedules;
  }
  if (!data.resources || typeof data.resources !== "object") {
    data.resources = {};
  }
  data.resources = Object.assign({
    teacherSchedules: data.teacherSchedules || [],
    classroomSchedules: data.classroomSchedules || [],
    courseSchedules: data.courseSchedules || [],
    classrooms: data.classrooms || [],
    teachers: data.teachers || [],
    courses: data.courses || [],
  }, data.resources);
  data.source = "relay-agent";
  data.relayTaskId = extra.taskId;
  data.relayUploadId = extra.uploadId;
  data.relayUploaderNote = extra.uploaderNote || "";
  return data;
}

function containsSensitiveData(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveData(item));
  }
  if (typeof value === "object") {
    return Object.keys(value).some((key) => {
      if (SECRET_KEY_PATTERN.test(key)) return true;
      return containsSensitiveData(value[key]);
    });
  }
  if (typeof value === "string") {
    return /(JSESSIONID|CASTGC|password=|passwd=|ticket=|execution=|Authorization:|Bearer\s+[A-Za-z0-9._-]+)/i.test(value);
  }
  return false;
}

function validateStagingData(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Staging 数据必须是 JSON 对象"], warnings };
  }
  ["schemaVersion", "releaseVersion", "term", "termStartDate", "generatedAt"].forEach((field) => {
    if (!data[field]) {
      errors.push(`缺少关键元数据字段: ${field}`);
    }
  });
  const classSchedules = data.classSchedules || (data.resources && data.resources.classSchedules);
  if (!Array.isArray(classSchedules) || classSchedules.length === 0) {
    errors.push("缺少班级课程表数据 (classSchedules)");
  }
  if (containsSensitiveData(data)) {
    errors.push("Staging JSON 中包含疑似密码、Cookie、ticket、session 或 token 字段，已拒绝上传");
  }
  ["teacherSchedules", "classroomSchedules", "courseSchedules", "classrooms", "teachers", "courses"].forEach((key) => {
    const list = data[key] || (data.resources && data.resources[key]);
    if (!Array.isArray(list)) {
      warnings.push(`缺少资源维度数据: ${key}`);
    }
  });
  return { valid: errors.length === 0, errors, warnings };
}

function summarizeStagingData(data) {
  const resources = data.resources || {};
  const classSchedules = Array.isArray(data.classSchedules) ? data.classSchedules : [];
  const adminClassCount = classSchedules.filter((item) => item.displayType === "class-schedule" && !item.isAggregated).length;
  return {
    term: data.term || data.semester || "",
    releaseVersion: data.releaseVersion || data.version || "",
    generatedAt: data.generatedAt || data.updatedAt || "",
    classScheduleCount: classSchedules.length,
    adminClassCount,
    majorAggregateCount: classSchedules.length - adminClassCount,
    teacherScheduleCount: Array.isArray(resources.teacherSchedules) ? resources.teacherSchedules.length : 0,
    classroomScheduleCount: Array.isArray(resources.classroomSchedules) ? resources.classroomSchedules.length : 0,
    courseScheduleCount: Array.isArray(resources.courseSchedules) ? resources.courseSchedules.length : 0,
    classroomCount: Array.isArray(resources.classrooms) ? resources.classrooms.length : 0,
    teacherCount: Array.isArray(resources.teachers) ? resources.teachers.length : 0,
    courseCount: Array.isArray(resources.courses) ? resources.courses.length : 0,
  };
}

function recordUpload(token, input) {
  const task = validateTokenForUpload(token);
  const now = new Date().toISOString();
  const uploadId = `relay_upload_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const payload = normalizeStagingData(input.data, {
    taskId: task.id,
    uploadId,
    uploaderNote: normalizeString(input.uploaderNote),
  });
  const validation = validateStagingData(payload);
  if (!validation.valid) {
    const error = new Error("接力上传 Staging JSON 校验不通过");
    error.statusCode = 400;
    error.validation = validation;
    throw error;
  }

  const payloadPath = path.join(PAYLOAD_DIR, `${uploadId}.json`);
  writeJsonAtomic(payloadPath, payload);

  const upload = {
    id: uploadId,
    taskId: task.id,
    term: payload.term || task.term,
    source: "relay-agent",
    uploaderNote: normalizeString(input.uploaderNote),
    environment: normalizeString(input.environment),
    status: "pending-review",
    uploadedAt: now,
    payloadPath,
    validation,
    summary: summarizeStagingData(payload),
  };
  const uploads = readUploads();
  uploads.unshift(upload);
  writeUploads(uploads.slice(0, 1000));

  updateTask(task.id, (next) => {
    next.uploadCount = (next.uploadCount || 0) + 1;
    next.startedAt = next.startedAt || now;
    next.lastUploadAt = now;
    next.status = "pending-review";
  });

  return upload;
}

function listUploads() {
  return readUploads().map((upload) => Object.assign({}, upload, {
    payloadPath: undefined,
  }));
}

function findUploadById(id) {
  return readUploads().find((upload) => upload.id === id) || null;
}

function readUploadPayload(id) {
  const upload = findUploadById(id);
  if (!upload) return null;
  const payload = readJsonFile(upload.payloadPath, null);
  return payload ? { upload, payload } : null;
}

function updateUpload(id, updater) {
  const uploads = readUploads();
  const index = uploads.findIndex((upload) => upload.id === id);
  if (index < 0) return null;
  const next = Object.assign({}, uploads[index]);
  updater(next);
  next.updatedAt = new Date().toISOString();
  uploads[index] = next;
  writeUploads(uploads);
  return next;
}

function markUploadStaged(id) {
  const stagedAt = new Date().toISOString();
  const upload = updateUpload(id, (next) => {
    next.status = "staged";
    next.stagedAt = stagedAt;
  });
  if (upload) {
    updateTask(upload.taskId, (task) => {
      task.status = "pending-review";
      task.lastStagedUploadId = id;
    });
  }
  return upload;
}

function markUploadPublished(id, version) {
  const publishedAt = new Date().toISOString();
  const upload = updateUpload(id, (next) => {
    next.status = "published";
    next.publishedAt = publishedAt;
    next.publishedVersion = version || "";
  });
  if (upload) {
    updateTask(upload.taskId, (task) => {
      task.status = "published";
      task.publishedAt = publishedAt;
      task.publishedVersion = version || "";
    });
  }
  return upload;
}

module.exports = {
  createTask,
  deleteTask,
  findTaskById,
  findTaskByToken,
  getTaskStatus,
  listTasks,
  listUploads,
  markUploadPublished,
  markUploadStaged,
  normalizeStagingData,
  readUploadPayload,
  recordUpload,
  revokeTask,
  safeTaskForAgent,
  summarizeStagingData,
  validateTokenForUpload,
  validateStagingData,
};
