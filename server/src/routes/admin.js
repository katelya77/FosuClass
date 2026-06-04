/**
 * 管理员同步 API 路由：接收本地同步工具上传的教务数据并持久化到 storage。
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const config = require("../config");
const { safeLog } = require("../utils/safeLogger");
const scheduleNormalizer = require("../utils/scheduleNormalizer");
const adminAuth = require("../services/adminAuth");
const appConfigService = require("../services/appConfigService");
const feedbackService = require("../services/feedbackService");
const releaseService = require("../services/releaseService");
const relayService = require("../services/relayService");
const stagingUploadService = require("../services/stagingUploadService");

const STORAGE_DIR = path.join(__dirname, "../../storage");
const zlib = require("zlib");

const SNAPSHOTS_DIR = path.join(STORAGE_DIR, "snapshots");
const HISTORY_DIR = path.join(SNAPSHOTS_DIR, "history");
const RESOURCE_UPLOAD_DIR = path.join(STORAGE_DIR, "resource-upload-staging");

const DATA_DIR = path.join(__dirname, "../../data");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const AUDIT_LOG_PATH = path.join(DATA_DIR, "admin-audit-log.jsonl");
const CATALOG_META_PATH = path.join(STORAGE_DIR, "catalog-meta.json");
const QUALITY_IGNORES_PATH = path.join(STORAGE_DIR, "quality-ignores.json");
const SYNC_HISTORY_PATH = path.join(DATA_DIR, "sync-history.json");

// 确保目录存在
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}
if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}
if (!fs.existsSync(RESOURCE_UPLOAD_DIR)) {
  fs.mkdirSync(RESOURCE_UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

/**
 * 自动备份机制
 */
function createBackup(type, sourceFile) {
  try {
    if (!fs.existsSync(sourceFile)) return;
    const now = new Date();
    const pad = (num) => String(num).padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const backupName = `${type}-${timestamp}.json`;
    const destPath = path.join(BACKUPS_DIR, backupName);
    fs.copyFileSync(sourceFile, destPath);
    
    // 保留最近 30 个备份文件
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith(`${type}-`) && f.endsWith(".json"))
      .map(f => ({ name: f, path: path.join(BACKUPS_DIR, f), time: fs.statSync(path.join(BACKUPS_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);
      
    if (files.length > 30) {
      files.slice(30).forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) {}
      });
    }
  } catch (error) {
    safeLog("create-backup-failed", { type, error: error.message });
  }
}

/**
 * 审计日志写入
 */
function writeAuditLog(req, action, moduleName, target, summary) {
  try {
    const logItem = {
      time: new Date().toISOString(),
      action,
      module: moduleName,
      target: target || "",
      operator: "admin",
      summary: summary || "",
      ip: req.ip || req.headers["x-forwarded-for"] || ""
    };
    fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(logItem)}\n`, "utf-8");
  } catch (error) {
    safeLog("write-audit-log-failed", { error: error.message });
  }
}

// 缓存文件路径映射
const FILE_MAP = {
  catalog: path.join(STORAGE_DIR, "catalog.json"),
  majors: path.join(STORAGE_DIR, "majors.json"),
  "class-schedules": path.join(STORAGE_DIR, "class-schedules.json"),
  "teacher-schedules": path.join(STORAGE_DIR, "teacher-schedules.json"),
  "classroom-schedules": path.join(STORAGE_DIR, "classroom-schedules.json"),
  "course-schedules": path.join(STORAGE_DIR, "course-schedules.json"),
  "sync-meta": path.join(STORAGE_DIR, "sync-meta.json"),
  contributions: path.join(STORAGE_DIR, "contributions.json"),
};

const RESOURCE_FILE_BY_TYPE = {
  teacher: "teacher-schedules",
  classroom: "classroom-schedules",
  course: "course-schedules",
};

const RESOURCE_NAME_KEY_BY_TYPE = {
  teacher: "teacherName",
  classroom: "roomName",
  course: "courseName",
};

/**
 * 校验管理员 Token
 */
function verifyAdminToken(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = req.headers["x-admin-token"] || (bearerMatch ? bearerMatch[1] : "");
  
  if (!config.ADMIN_API_TOKEN) {
    safeLog("admin-sync-auth-failed", { reason: "ADMIN_API_TOKEN not configured on server" });
    return res.status(401).json({
      success: false,
      message: "服务器未配置 ADMIN_API_TOKEN，拒绝写入请求",
    });
  }

  if (token !== config.ADMIN_API_TOKEN) {
    safeLog("admin-sync-auth-failed", { reason: "Invalid or missing token" });
    return res.status(401).json({
      success: false,
      message: "管理员令牌无效",
    });
  }

  next();
}

function verifyAdminWriteAccess(req, res, next) {
  if (!adminAuth.isAdminConfiguredForCurrentEnv()) {
    safeLog("admin-write-auth-failed", { reason: "ADMIN_TOKEN or ADMIN_PASSWORD not configured" });
    return res.status(503).json({
      success: false,
      message: "生产环境未配置 ADMIN_TOKEN 或 ADMIN_PASSWORD，后台已关闭",
    });
  }

  if (adminAuth.isAdminRequest(req)) {
    return next();
  }

  safeLog("admin-write-auth-failed", { reason: "missing cookie session or ADMIN_API_TOKEN" });
  return res.status(401).json({
    success: false,
    message: "请先登录后台或提供有效 ADMIN_API_TOKEN",
  });
}

router.post("/login", adminAuth.adminLoginLimiter, (req, res) => {
  if (!adminAuth.isAdminConfiguredForCurrentEnv()) {
    return res.status(503).json({
      success: false,
      message: "生产环境未配置 ADMIN_TOKEN 或 ADMIN_PASSWORD，后台已关闭",
    });
  }

  const credential = (req.body && (req.body.password || req.body.token)) || "";
  if (!adminAuth.isLoginCredentialValid(credential)) {
    safeLog("admin-login-failed", { reason: "invalid credential", ip: req.ip });
    return res.status(401).json({
      success: false,
      message: "后台密码或令牌不正确",
    });
  }

  const sessionToken = adminAuth.createSessionToken();
  adminAuth.setSessionCookie(res, sessionToken);
  return res.json({
    success: true,
    message: "登录成功",
    expiresIn: 12 * 60 * 60,
  });
});

router.post("/logout", (req, res) => {
  adminAuth.clearSessionCookie(res);
  return res.json({
    success: true,
    message: "已退出后台",
  });
});

router.get("/session", (req, res) => {
  return res.json({
    success: true,
    authenticated: adminAuth.isAdminRequest(req),
    configured: adminAuth.isAdminConfiguredForCurrentEnv(),
  });
});

/**
 * 读取或初始化元数据
 */
function getSyncMeta() {
  try {
    if (fs.existsSync(FILE_MAP["sync-meta"])) {
      return JSON.parse(fs.readFileSync(FILE_MAP["sync-meta"], "utf-8"));
    }
  } catch (error) {
    safeLog("read-sync-meta-failed", { error: error.message });
  }
  return {};
}

/**
 * 写入元数据
 */
function updateSyncMeta(key, dataCount, syncSource) {
  const updatedAt = new Date().toISOString();
  const meta = getSyncMeta();
  meta[key] = {
    updatedAt,
    itemCount: dataCount,
    syncSource: syncSource || "local-sync-client",
  };
  try {
    fs.writeFileSync(FILE_MAP["sync-meta"], JSON.stringify(meta, null, 2), "utf-8");
    appConfigService.touchDataVersionForSyncKey(key, {
      updatedAt,
      releaseNote: "全校课表数据已更新",
    });
  } catch (error) {
    safeLog("write-sync-meta-failed", { error: error.message });
  }
}

/**
 * 获取统计数据项数
 */
function getItemCount(key) {
  const meta = getSyncMeta();
  return meta[key] ? meta[key].itemCount : 0;
}

/**
 * 获取更新时间
 */
function getUpdatedAt(key) {
  const meta = getSyncMeta();
  return meta[key] ? meta[key].updatedAt : null;
}

/**
 * 校验上传的敏感字段（不能包含 Cookie、JSESSIONID 等敏感信息）
 */
function containsSensitiveData(data) {
  const str = JSON.stringify(data).toLowerCase();
  return (
    str.includes("cookie") ||
    str.includes("jsessionid") ||
    str.includes("authorization") ||
    str.includes("token") ||
    str.includes("casticket") ||
    str.includes("password") ||
    str.includes("passwd")
  );
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function sanitizeUploadId(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    safeLog("read-json-array-failed", { filePath, error: error.message });
    return [];
  }
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return data == null ? fallback : data;
  } catch (error) {
    safeLog("read-json-file-failed", { filePath, error: error.message });
    return fallback;
  }
}

function toInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const match = String(value == null ? "" : value).match(/\d+/);
  return match ? parseInt(match[0], 10) : NaN;
}

function uniqueNumbers(values, min, max) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const num = toInteger(value);
    if (Number.isFinite(num) && num >= min && num <= max && !seen.has(num)) {
      seen.add(num);
      result.push(num);
    }
  });
  return result.sort((left, right) => left - right);
}

function rangeNumbers(start, end, min, max) {
  const first = toInteger(start);
  const last = toInteger(end);
  if (!Number.isFinite(first)) {
    return [];
  }
  if (!Number.isFinite(last)) {
    return uniqueNumbers([first], min, max);
  }
  const low = Math.min(first, last);
  const high = Math.max(first, last);
  const values = [];
  for (let value = low; value <= high; value += 1) {
    values.push(value);
  }
  return uniqueNumbers(values, min, max);
}

function parseChineseWeekday(text) {
  const value = String(text == null ? "" : text);
  const map = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
  };
  const match = value.match(/[一二三四五六日天]/);
  return match ? map[match[0]] : NaN;
}

function normalizeWeekday(value, key) {
  const chinese = parseChineseWeekday(value);
  if (Number.isFinite(chinese)) {
    return chinese;
  }
  const num = toInteger(value);
  if (!Number.isFinite(num)) {
    return NaN;
  }
  if (key === "dayIndex" && num >= 0 && num <= 6) {
    return num + 1;
  }
  return num >= 1 && num <= 7 ? num : NaN;
}

function parseSectionSequence(text) {
  const source = String(text == null ? "" : text);
  const raw = source.match(/\d{1,2}/g) || [];
  const nums = raw.map((item) => parseInt(item, 10)).filter((num) => Number.isFinite(num));
  if (nums.length === 2 && /[-~～至到]/.test(source)) {
    return rangeNumbers(nums[0], nums[1], 1, 14);
  }
  return uniqueNumbers(nums, 1, 14);
}

function parseSectionText(text) {
  const source = String(text == null ? "" : text);
  const sections = [];
  const patterns = [
    /[\[【(（]\s*(\d{1,2}(?:\s*[-,，、~～至到]\s*\d{1,2})*)\s*[\]】)）]\s*节?/g,
    /第\s*(\d{1,2})\s*(?:[-~～至到]\s*(\d{1,2}))?\s*节/g,
    /(?:^|[^\dA-Za-z])(\d{1,2}(?:\s*[-~～]\s*\d{1,2})+)\s*节/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[2]) {
        sections.push(...rangeNumbers(match[1], match[2], 1, 14));
      } else {
        sections.push(...parseSectionSequence(match[1]));
      }
    }
  });
  return uniqueNumbers(sections, 1, 14);
}

function parseWeekText(text) {
  const source = String(text == null ? "" : text);
  if (!source) {
    return [];
  }
  if (source.includes("单周")) {
    return uniqueNumbers(Array.from({ length: 13 }, (_, index) => index * 2 + 1), 1, 30);
  }
  if (source.includes("双周")) {
    return uniqueNumbers(Array.from({ length: 15 }, (_, index) => (index + 1) * 2), 1, 30);
  }
  if (!source.includes("周")) {
    return [];
  }

  const weeks = [];
  const re = /(\d{1,2})(?:\s*[-~～至到]\s*(\d{1,2}))?\s*周/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match[2]) {
      weeks.push(...rangeNumbers(match[1], match[2], 1, 30));
    } else {
      weeks.push(toInteger(match[1]));
    }
  }
  return uniqueNumbers(weeks, 1, 30);
}

function normalizeCourseSlot(course) {
  const source = course && typeof course === "object" ? course : {};
  const weekdayKeys = ["weekday", "weekDay", "dayOfWeek", "day", "xqj", "dayIndex"];
  let weekday = NaN;
  for (const key of weekdayKeys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      weekday = normalizeWeekday(source[key], key);
      if (Number.isFinite(weekday)) {
        break;
      }
    }
  }

  let sections = [];
  if (Array.isArray(source.sections)) {
    sections = uniqueNumbers(source.sections, 1, 14);
  }
  if (sections.length === 0) {
    sections = uniqueNumbers([source.section, source.sectionIndex], 1, 14);
  }

  const pairs = [
    ["startSection", "endSection"],
    ["sectionStart", "sectionEnd"],
    ["start", "end"],
  ];
  for (const pair of pairs) {
    if (sections.length > 0) {
      break;
    }
    if (source[pair[0]] !== undefined || source[pair[1]] !== undefined) {
      sections = rangeNumbers(source[pair[0]], source[pair[1]], 1, 14);
    }
  }

  if (sections.length === 0) {
    [
      { text: source.section, loose: true },
      { text: source.sectionIndex, loose: true },
      { text: source.sectionText, loose: true },
      { text: source.sectionsText, loose: true },
      { text: source.rawSection, loose: true },
      { text: source.rawSections, loose: true },
      { text: source.timeText, loose: false },
      { text: source.period, loose: true },
      { text: source.periodText, loose: true },
      { text: source.rawText, loose: false },
    ].some((item) => {
      sections = parseSectionText(item.text);
      if (sections.length === 0 && item.loose && /[-,，、~～至到]/.test(String(item.text == null ? "" : item.text))) {
        sections = parseSectionSequence(item.text);
      }
      return sections.length > 0;
    });
  }

  let weeks = [];
  ["weeks", "weekList", "weekNumbers"].some((key) => {
    if (Array.isArray(source[key])) {
      weeks = uniqueNumbers(source[key], 1, 30);
      return weeks.length > 0;
    }
    return false;
  });
  if (weeks.length === 0) {
    ["weeksText", "rawWeeks", "weekRange", "weekText", "rawText"].some((key) => {
      weeks = parseWeekText(source[key]);
      return weeks.length > 0;
    });
  }

  return {
    weekday: Number.isFinite(weekday) ? weekday : null,
    sections,
    weeks,
  };
}

function getScheduleCourses(schedule) {
  if (!schedule || typeof schedule !== "object") {
    return [];
  }
  const keys = ["courses", "items", "schedule", "lessons", "courseList"];
  for (const key of keys) {
    if (Array.isArray(schedule[key])) {
      return schedule[key];
    }
  }
  return [];
}

function getClassroomNameFromSchedule(schedule, index) {
  const name = normalizeString(schedule && (
    schedule.roomName ||
    schedule.classroom ||
    schedule.displayClassroom ||
    schedule.canonicalClassroom ||
    schedule.name ||
    schedule.title
  ));
  return name || `classroom-${index + 1}`;
}

function getClassroomNameFromCourse(course) {
  return normalizeString(course && (
    course.classroom ||
    course.displayClassroom ||
    course.canonicalClassroom ||
    course.rawClassroom ||
    course.roomName ||
    course.room ||
    course.location ||
    course.venue
  ));
}

function deriveClassroomSchedulesFromClassSchedules(classSchedules) {
  const rooms = new Map();
  (Array.isArray(classSchedules) ? classSchedules : []).forEach((schedule) => {
    getScheduleCourses(schedule).forEach((course) => {
      const roomName = getClassroomNameFromCourse(course);
      if (!roomName) {
        return;
      }
      if (!rooms.has(roomName)) {
        rooms.set(roomName, { roomName, courses: [] });
      }
      rooms.get(roomName).courses.push(course);
    });
  });
  return Array.from(rooms.values());
}

function getActiveSnapshotDataSafe() {
  try {
    if (typeof releaseService.getActiveSnapshotData === "function") {
      return releaseService.getActiveSnapshotData();
    }
    return releaseService.readActiveReleaseSnapshot();
  } catch (error) {
    safeLog("admin-active-snapshot-read-failed", { error: error.message });
    return null;
  }
}

function getSnapshotResourceArray(snapshot, key) {
  if (!snapshot || typeof snapshot !== "object") {
    return [];
  }
  const resources = snapshot.resources || {};
  const map = {
    "class-schedules": snapshot.classSchedules,
    "teacher-schedules": resources.teacherSchedules,
    "classroom-schedules": resources.classroomSchedules || snapshot.classroomSchedules,
    "course-schedules": resources.courseSchedules,
  };
  return Array.isArray(map[key]) ? map[key] : [];
}

function getResourceArrayWithSource(key) {
  const snapshot = getActiveSnapshotDataSafe();
  const snapshotItems = getSnapshotResourceArray(snapshot, key);
  if (snapshotItems.length > 0) {
    return {
      items: snapshotItems,
      source: key === "classroom-schedules" ? "release.resources.classroomSchedules" : `release.${key}`,
      updatedAt: snapshot.updatedAt || null,
      snapshot,
    };
  }

  const filePath = FILE_MAP[key];
  return {
    items: readJsonArray(filePath),
    source: `storage.${key}`,
    updatedAt: fs.existsSync(filePath) ? fs.statSync(filePath).mtime.toISOString() : null,
    snapshot,
  };
}

function buildClassroomHeatmap(options) {
  const opt = options || {};
  const source = opt.source || "unknown";
  let classroomSchedules = Array.isArray(opt.classroomSchedules) ? opt.classroomSchedules : [];
  const classSchedules = Array.isArray(opt.classSchedules) ? opt.classSchedules : [];

  if (classroomSchedules.length === 0 && classSchedules.length > 0) {
    classroomSchedules = deriveClassroomSchedulesFromClassSchedules(classSchedules);
  }

  // 1. 获取并应用动态筛选维度
  const targetSemester = opt.semester; // 比如 "2025-2026-2"
  const targetWeek = opt.week && opt.week !== "all" ? parseInt(opt.week, 10) : null;
  const targetBuilding = opt.building; // 模糊匹配，如 "C7" 或 "B8"

  let filteredRooms = classroomSchedules;
  if (targetBuilding) {
    filteredRooms = filteredRooms.filter((room, index) => {
      const roomName = getClassroomNameFromSchedule(room, index);
      return roomName.toLowerCase().includes(targetBuilding.toLowerCase());
    });
  }

  const classroomIndex = Array.isArray(opt.classrooms) ? opt.classrooms : [];
  const totalClassrooms = targetBuilding
    ? filteredRooms.length
    : (classroomIndex.length > 0 ? classroomIndex.length : filteredRooms.length);
  const counts = Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => new Set()));
  const roomSlotCounts = new Map();
  
  // 记录每个格子被哪些教室占用以及什么课程，供前端点击展示详情
  const slotDetails = Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => []));

  filteredRooms.forEach((room, index) => {
    const roomName = getClassroomNameFromSchedule(room, index);
    const roomSlots = roomSlotCounts.get(roomName) || new Set();
    
    getScheduleCourses(room).forEach((course) => {
      // 学期过滤
      const courseTerm = course.term || course.semester || room.semester || room.term || opt.updatedSemester;
      if (targetSemester && courseTerm && courseTerm !== targetSemester) {
        return;
      }

      const slot = normalizeCourseSlot(course);
      if (!slot.weekday || slot.sections.length === 0) {
        return;
      }

      // 周次过滤
      if (targetWeek && slot.weeks.length > 0 && !slot.weeks.includes(targetWeek)) {
        return;
      }

      slot.sections.forEach((section) => {
        const dayIndex = slot.weekday - 1;
        const sectionIndex = section - 1;
        counts[dayIndex][sectionIndex].add(roomName);
        roomSlots.add(`${slot.weekday}-${section}`);
        
        // 限制每个格子详情数量为 30 个，防止返回体积过大
        if (slotDetails[dayIndex][sectionIndex].length < 30) {
          slotDetails[dayIndex][sectionIndex].push({
            roomName: roomName,
            courseName: course.courseName || course.name || "未知课程",
            teacher: course.teacherName || course.teacher || "未知教师",
          });
        }
      });
    });
    roomSlotCounts.set(roomName, roomSlots);
  });

  const heatmap = Array.from({ length: 7 }, () => Array(14).fill(0));
  const rawCounts = Array.from({ length: 7 }, () => Array(14).fill(0));
  let totalOccupiedSlots = 0;
  let maxOccupancy = 0;

  // 统计摘要指标
  let maxOccupancyRate = 0;
  let maxOccupancyTime = "";
  let minOccupancyRate = 100;
  let minOccupancyTime = "";
  const weekdaysMap = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  for (let day = 0; day < 7; day += 1) {
    for (let section = 0; section < 14; section += 1) {
      const occupied = counts[day][section].size;
      rawCounts[day][section] = occupied;
      if (occupied > 0) {
        totalOccupiedSlots += 1;
      }
      maxOccupancy = Math.max(maxOccupancy, occupied);
      
      const rate = totalClassrooms > 0
        ? Math.min(100, Math.round((occupied / totalClassrooms) * 100))
        : 0;
      heatmap[day][section] = rate;

      // 寻找最繁忙/最空闲时段
      if (rate > maxOccupancyRate) {
        maxOccupancyRate = rate;
        maxOccupancyTime = `${weekdaysMap[day]} 第${section + 1}节`;
      }
      if (rate < minOccupancyRate) {
        minOccupancyRate = rate;
        minOccupancyTime = `${weekdaysMap[day]} 第${section + 1}节`;
      }
    }
  }

  // 计算工作日与周末平均占用率
  let workdaySum = 0;
  let weekendSum = 0;
  for (let section = 0; section < 14; section += 1) {
    for (let day = 0; day < 5; day += 1) {
      workdaySum += heatmap[day][section];
    }
    for (let day = 5; day < 7; day += 1) {
      weekendSum += heatmap[day][section];
    }
  }
  const workdayAvg = Math.round(workdaySum / (5 * 14));
  const weekendAvg = Math.round(weekendSum / (2 * 14));

  // 晚课占用率 (第 11 节至第 14 节)
  let nightSum = 0;
  for (let day = 0; day < 7; day += 1) {
    for (let section = 10; section < 14; section += 1) {
      nightSum += heatmap[day][section];
    }
  }
  const nightAvg = Math.round(nightSum / (7 * 4));

  // Top 10 繁忙教室
  const topRooms = Array.from(roomSlotCounts.entries())
    .map(([roomName, slots]) => ({
      roomName,
      occupiedSlots: slots.size,
      occupationRate: Math.min(100, Math.round((slots.size / 98) * 100)),
    }))
    .filter((item) => item.occupiedSlots > 0)
    .sort((left, right) => right.occupiedSlots - left.occupiedSlots)
    .slice(0, 10);

  const hasRecognizedSlots = totalOccupiedSlots > 0;
  return {
    classroomHeatmap: heatmap,
    classroomHeatmapCounts: rawCounts,
    classroomHeatmapDetails: slotDetails,
    classroomHeatmapMeta: {
      totalClassrooms,
      totalOccupiedSlots,
      source,
      updatedAt: opt.updatedAt || null,
      maxOccupancy,
      topRooms,
      summary: {
        maxOccupancyRate,
        maxOccupancyTime: maxOccupancyRate > 0 ? maxOccupancyTime : "无 (0%)",
        minOccupancyRate,
        minOccupancyTime: minOccupancyRate === 0 ? minOccupancyTime : "无 (都大于0%)",
        workdayAvg,
        weekendAvg,
        nightAvg
      },
      emptyReason: totalClassrooms === 0
        ? "no-classroom-schedules"
        : (hasRecognizedSlots ? "" : "no-recognized-course-slots"),
    },
  };
}

function resolveClassroomHeatmapData(filterOptions) {
  const classroomSource = getResourceArrayWithSource("classroom-schedules");
  const opts = filterOptions || {};
  if (classroomSource.items.length > 0) {
    return buildClassroomHeatmap(Object.assign({
      classroomSchedules: classroomSource.items,
      classrooms: classroomSource.snapshot?.resources?.classrooms || [],
      source: classroomSource.source,
      updatedAt: classroomSource.updatedAt,
    }, opts));
  }

  const snapshotClassSchedules = getSnapshotResourceArray(classroomSource.snapshot, "class-schedules");
  if (snapshotClassSchedules.length > 0) {
    return buildClassroomHeatmap(Object.assign({
      classSchedules: snapshotClassSchedules,
      source: "derived-from-classSchedules",
      updatedAt: classroomSource.snapshot && classroomSource.snapshot.updatedAt,
    }, opts));
  }

  const storageClassSchedules = readJsonArray(FILE_MAP["class-schedules"]);
  return buildClassroomHeatmap(Object.assign({
    classSchedules: storageClassSchedules,
    source: storageClassSchedules.length > 0 ? "derived-from-classSchedules" : "storage.classroom-schedules",
    updatedAt: getUpdatedAt("class-schedules") || getUpdatedAt("classroom-schedules"),
  }, opts));
}

function buildCollegeDistribution() {
  const classSource = getResourceArrayWithSource("class-schedules");
  const classes = classSource.items;
  const counts = new Map();
  classes.forEach((item) => {
    const name = normalizeString(item.collegeName || item.college || item.schoolName);
    if (!name) {
      return;
    }
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  const max = Math.max(0, ...counts.values());
  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count,
      pct: max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
}

function getAdminDataVersion() {
  const dashboard = appConfigService.getAdminDashboard();
  return (dashboard && dashboard.data && dashboard.data.dataVersion) || {};
}

function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
}

function getResourceItemKey(resourceType, item, index) {
  const nameKey = RESOURCE_NAME_KEY_BY_TYPE[resourceType];
  const name = normalizeString(item && (item[nameKey] || item.name || item.title));
  return [
    resourceType,
    normalizeString(item && item.semester),
    name || `index-${index}`,
  ].join("::");
}

function mergeResourceItems(resourceType, existingItems, incomingItems) {
  const merged = new Map();
  existingItems.forEach((item, index) => {
    merged.set(getResourceItemKey(resourceType, item, index), item);
  });
  incomingItems.forEach((item, index) => {
    merged.set(getResourceItemKey(resourceType, item, index), item);
  });
  return Array.from(merged.values());
}

function persistResourceItems(resourceType, key, items, syncSource) {
  const filePath = FILE_MAP[key];
  writeJsonAtomic(filePath, items);
  updateSyncMeta(key, items.length, syncSource || "local-sync-client");
  return {
    success: true,
    resourceType,
    itemCount: items.length,
    updatedAt: new Date().toISOString(),
  };
}

function stageResourceChunk(resourceType, key, body, items) {
  const uploadId = sanitizeUploadId(body.uploadId);
  const totalChunks = parseInt(body.totalChunks || "0", 10);
  const chunkIndex = parseInt(body.chunkIndex || "0", 10);

  if (!uploadId || !Number.isFinite(totalChunks) || totalChunks <= 1) {
    const existing = body.mode === "merge" ? readJsonArray(FILE_MAP[key]) : [];
    const finalItems = body.mode === "merge"
      ? mergeResourceItems(resourceType, existing, items)
      : items;
    return persistResourceItems(resourceType, key, finalItems, body.syncSource);
  }

  if (!Number.isFinite(chunkIndex) || chunkIndex < 1 || chunkIndex > totalChunks) {
    const err = new Error("invalid resource chunk index");
    err.statusCode = 400;
    throw err;
  }

  const typeDir = path.join(RESOURCE_UPLOAD_DIR, resourceType);
  const uploadDir = path.join(typeDir, uploadId);
  const completePath = path.join(typeDir, `${uploadId}.complete.json`);
  fs.mkdirSync(typeDir, { recursive: true });
  if (fs.existsSync(completePath)) {
    return JSON.parse(fs.readFileSync(completePath, "utf-8"));
  }
  fs.mkdirSync(uploadDir, { recursive: true });

  const chunkPath = path.join(uploadDir, `chunk-${String(chunkIndex).padStart(6, "0")}.json`);
  writeJsonAtomic(chunkPath, {
    resourceType,
    chunkIndex,
    totalChunks,
    items,
    receivedAt: new Date().toISOString(),
  });

  const chunkFiles = fs.readdirSync(uploadDir)
    .filter((file) => /^chunk-\d+\.json$/.test(file))
    .sort();
  if (chunkFiles.length < totalChunks) {
    return {
      success: true,
      resourceType,
      uploadId,
      chunkIndex,
      totalChunks,
      stagedCount: chunkFiles.length,
      completed: false,
    };
  }

  const finalItems = [];
  for (let index = 1; index <= totalChunks; index += 1) {
    const filePath = path.join(uploadDir, `chunk-${String(index).padStart(6, "0")}.json`);
    if (!fs.existsSync(filePath)) {
      return {
        success: true,
        resourceType,
        uploadId,
        chunkIndex,
        totalChunks,
        stagedCount: chunkFiles.length,
        completed: false,
      };
    }
    const chunk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    finalItems.push(...(Array.isArray(chunk.items) ? chunk.items : []));
  }

  const result = persistResourceItems(resourceType, key, finalItems, body.syncSource);
  const completedResult = Object.assign(result, {
    uploadId,
    totalChunks,
    completed: true,
  });
  writeJsonAtomic(completePath, completedResult);
  try {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  } catch (error) {
    safeLog("resource-upload-cleanup-failed", { uploadDir, error: error.message });
  }
  return completedResult;
}

function getFallbackSemester() {
  if (process.env.PREFERRED_SEMESTER) {
    return process.env.PREFERRED_SEMESTER;
  }

  try {
    const catalogPath = FILE_MAP.catalog;
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
      const semester = catalog?.semesters?.[0]?.value;
      if (semester) {
        return semester;
      }
    }
  } catch (error) {
    safeLog("read-fallback-semester-failed", { error: error.message });
  }

  return "2025-2026-2";
}

function parseClassSchedulesPayload(body) {
  if (Array.isArray(body)) {
    return {
      schedules: body,
      semester: "",
    };
  }

  if (body && typeof body === "object") {
    const schedules = body.classSchedules || body.schedules || body.items;
    return {
      schedules,
      semester: normalizeString(body.semester || body.preferredSemester),
    };
  }

  return {
    schedules: null,
    semester: "",
  };
}

function normalizeClassScheduleItem(item, fallbackSemester) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const semester = normalizeString(item.semester || fallbackSemester || getFallbackSemester());
  const collegeCode = normalizeString(item.collegeCode);
  const collegeName = normalizeString(item.collegeName);
  const grade = normalizeString(item.grade);
  const majorCode = normalizeString(item.majorCode || item.code);
  const majorName = normalizeString(item.majorName || item.name);
  const isAggregated = Boolean(item.isAggregated) || normalizeString(item.displayType) === "major-schedule";
  const displayType = normalizeString(item.displayType) || (isAggregated ? "major-schedule" : "class-schedule");
  const className =
    normalizeString(item.className) ||
    (isAggregated
      ? scheduleNormalizer.buildMajorScheduleName({ grade, majorName })
      : `未命名班级-${collegeCode}-${grade}-${majorCode}`);

  return {
    ...item,
    semester,
    collegeCode,
    collegeName,
    grade,
    majorCode,
    majorName,
    className,
    displayType,
    isAggregated,
    courses: Array.isArray(item.courses) ? item.courses : [],
  };
}

function getClassScheduleMajorKey(item) {
  return [
    item.semester,
    item.collegeCode,
    item.grade,
    item.majorCode,
  ].map(normalizeString).join("::");
}

function getClassScheduleCompositeKey(item) {
  return [
    item.semester,
    item.collegeCode,
    item.grade,
    item.majorCode,
    item.className,
  ].map(normalizeString).join("::");
}

function normalizeClassScheduleList(items, fallbackSemester) {
  return items
    .map((item) => normalizeClassScheduleItem(item, fallbackSemester))
    .filter(Boolean);
}

function isStorageMounted() {
  try {
    return (
      fs.existsSync(STORAGE_DIR) &&
      fs.statSync(STORAGE_DIR).isDirectory() &&
      fs.accessSync(STORAGE_DIR, fs.constants.R_OK | fs.constants.W_OK) === undefined
    );
  } catch (error) {
    return false;
  }
}

/**
 * 通用同步处理逻辑
 * @param {string} key 缓存的 key，如 'catalog', 'majors' 等
 * @param {Function} validateFn 校验函数，返回 boolean
 */
function createSyncHandler(key, validateFn) {
  return (req, res) => {
    const payload = req.body;

    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "请求体不能为空或空数组",
      });
    }

    if (containsSensitiveData(payload)) {
      safeLog("sensitive-data-blocked", { type: key });
      return res.status(400).json({
        success: false,
        message: "数据中包含敏感词（如 Cookie/JSESSIONID/密码），已被拒绝写入",
      });
    }

    if (validateFn && !validateFn(payload)) {
      return res.status(400).json({
        success: false,
        message: "数据 Schema 格式校验未通过",
      });
    }

    try {
      const filePath = FILE_MAP[key];
      // 写入物理文件
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
      
      // 计算条目数
      let count = 0;
      if (Array.isArray(payload)) {
        count = payload.length;
      } else if (key === "catalog") {
        count = (payload.colleges || []).length; // 学院数作为指标
      } else {
        count = Object.keys(payload).length;
      }

      // 更新同步元数据
      updateSyncMeta(key, count, "local-sync-client");

      safeLog("admin-sync-success", { key, count });

      return res.json({
        success: true,
        message: "数据同步成功",
        updatedAt: new Date().toISOString(),
        itemCount: count,
      });
    } catch (error) {
      safeLog("admin-sync-failed", { key, error: error.message });
      return res.status(500).json({
        success: false,
        message: `数据持久化失败: ${error.message}`,
      });
    }
  };
}

// 1. 同步 Catalog
router.post(
  "/sync/catalog",
  verifyAdminWriteAccess,
  createSyncHandler("catalog", (data) => {
    return data && Array.isArray(data.colleges) && Array.isArray(data.semesters) && Array.isArray(data.grades);
  })
);

// 2. 同步 Majors (自定义 handler)
router.post(
  "/sync/majors",
  verifyAdminWriteAccess,
  (req, res) => {
    console.log("[DEBUG /sync/majors] Received request, body length:", req.body ? req.body.length : "null");
    const payload = req.body;
    const allowHistorical = req.query.allowHistorical === 'true' || req.body.allowHistorical === true;

    // 1. 基础数组与空校验
    if (!payload || !Array.isArray(payload)) {
      return res.status(400).json({
        success: false,
        message: "请求体不能为空，且必须是专业数据数组",
        detail: "Payload must be a non-empty array of majors",
        hint: "确保客户端上传的数据为 Array 格式"
      });
    }

    if (containsSensitiveData(payload)) {
      safeLog("sensitive-data-blocked", { type: "majors" });
      return res.status(400).json({
        success: false,
        message: "数据中包含敏感词（如 Cookie/JSESSIONID/密码），已被拒绝写入",
      });
    }

    // 脱敏辅助函数，移除敏感信息
    const sanitizeItem = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      const copy = { ...obj };
      const sensitiveKeys = ["cookie", "cookies", "password", "passwd", "session", "sessionid", "jsessionid", "token", "ticket"];
      for (const k of Object.keys(copy)) {
        if (sensitiveKeys.includes(k.toLowerCase())) {
          delete copy[k];
        }
      }
      return copy;
    };

    try {
      // 2. 读取已存 catalog.json 辅助映射与提取学期
      const catalogPath = path.join(STORAGE_DIR, "catalog.json");
      let catalog = {};
      if (fs.existsSync(catalogPath)) {
        try {
          catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
        } catch (e) {
          console.error("Failed to parse catalog.json:", e);
        }
      }

      const collegeMap = {};
      if (catalog.colleges) {
        catalog.colleges.forEach(c => {
          collegeMap[c.code] = c.name;
        });
      }

      const semester = catalog.semesters?.[0]?.value || "2025-2026-2";
      const startYear = parseInt(semester.match(/^(\d{4})/)?.[1] || "2025", 10);

      // 3. 清洗与过滤
      const cleanedMajors = [];
      const seen = new Set();
      const crypto = require("crypto");
      
      const rawCount = payload.length;
      let skippedCount = 0;
      let generatedCodeCount = 0;

      const placeholders = ["请选择", "全部", "全部专业", "--请选择--", "请选择专业"];

      for (let i = 0; i < payload.length; i++) {
        const item = payload[i];
        if (!item || typeof item !== 'object') {
          skippedCount++;
          continue;
        }

        const collegeCodeRaw = item.collegeCode;
        const gradeRaw = item.grade;
        const majorCodeRaw = item.majorCode || item.code || item.value;
        const majorNameRaw = item.majorName || item.name || item.rawLabel || item.text || item.label;

        const collegeCode = collegeCodeRaw !== undefined && collegeCodeRaw !== null ? String(collegeCodeRaw).trim() : '';
        const grade = gradeRaw !== undefined && gradeRaw !== null ? String(gradeRaw).trim() : '';
        
        const majorName = typeof majorNameRaw === 'string' ? majorNameRaw.trim() : (majorNameRaw !== undefined && majorNameRaw !== null ? String(majorNameRaw).trim() : '');
        let majorCode = typeof majorCodeRaw === 'string' ? majorCodeRaw.trim() : (majorCodeRaw !== undefined && majorCodeRaw !== null ? String(majorCodeRaw).trim() : '');

        // 校验基础结构
        if (!collegeCode || !grade) {
          // 如果缺失了必要的属性，在脱敏后返回 400 指出具体字段
          return res.status(400).json({
            success: false,
            message: `数据校验未通过：缺失 collegeCode 或 grade`,
            detail: `第 ${i} 条数据不合规，内容: ${JSON.stringify(sanitizeItem(item))}`,
            hint: "请确保所有专业都包含有效的 collegeCode 和 grade 字段"
          });
        }

        // 跳过无效专业项 (空专业名或占位符)
        if (!majorName || placeholders.includes(majorName) || (!majorCode && !majorName)) {
          skippedCount++;
          continue;
        }

        // 如果没有 majorCode 但 majorName 有效，则使用 stable hash 生成
        if (!majorCode) {
          majorCode = crypto.createHash("md5").update(majorName).digest("hex").substring(0, 8);
          generatedCodeCount++;
        }

        // 非法年级过滤：如果不允许历史年级，则必须在 [startYear - 4, startYear] 范围内
        if (!allowHistorical) {
          const gradeNum = parseInt(grade, 10);
          if (isNaN(gradeNum) || gradeNum < (startYear - 4) || gradeNum > startYear) {
            skippedCount++;
            continue; // 过滤非在校年级
          }
        }

        const uniqueKey = `${collegeCode}_${grade}_${majorCode}`;
        if (seen.has(uniqueKey)) {
          skippedCount++;
          continue; // 去重跳过
        }
        seen.add(uniqueKey);

        cleanedMajors.push({
          collegeCode,
          grade,
          code: majorCode,
          name: majorName
        });
      }

      // 4. 清洗后如果有效专业数量为 0，返回 400
      if (cleanedMajors.length === 0) {
        return res.status(400).json({
          success: false,
          message: "没有有效专业数据",
          code: "NO_VALID_MAJORS",
          hint: "请检查教务联动解析结果。"
        });
      }

      // 5. 组织嵌套的 majors-index.json 数据结构
      const collegesObj = {};
      for (const major of cleanedMajors) {
        const { collegeCode, grade, code, name } = major;
        const collegeName = collegeMap[collegeCode] || "未知学院";

        if (!collegesObj[collegeCode]) {
          collegesObj[collegeCode] = {
            collegeCode,
            collegeName,
            grades: {}
          };
        }

        if (!collegesObj[collegeCode].grades[grade]) {
          collegesObj[collegeCode].grades[grade] = {
            grade,
            majors: []
          };
        }

        collegesObj[collegeCode].grades[grade].majors.push({
          majorCode: code,
          majorName: name,
          rawLabel: name
        });
      }

      const collegesList = Object.values(collegesObj).map(c => {
        return {
          collegeCode: c.collegeCode,
          collegeName: c.collegeName,
          grades: Object.values(c.grades).map(g => {
            g.majors.sort((a, b) => a.majorCode.localeCompare(b.majorCode));
            return g;
          }).sort((a, b) => b.grade.localeCompare(a.grade))
        };
      }).sort((a, b) => a.collegeCode.localeCompare(b.collegeCode));

      const gradesSet = new Set(cleanedMajors.map(m => m.grade));
      const gradesList = Array.from(gradesSet).sort((a, b) => b.localeCompare(a));

      const now = new Date();
      const yy = String(now.getFullYear()).substring(2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const version = `${yy}.${mm}.${dd}.01`;

      const majorsIndexPayload = {
        version,
        semester,
        gradeRange: allowHistorical ? "all" : "active",
        grades: gradesList,
        updatedAt: now.toISOString(),
        colleges: collegesList
      };

      // 6. 持久化存储
      const majorsIndexPath = path.join(STORAGE_DIR, "majors-index.json");
      fs.writeFileSync(majorsIndexPath, JSON.stringify(majorsIndexPayload, null, 2), "utf-8");

      // 更新同步元数据 (注意：元数据中的 itemCount 设为清洗后的专业总数)
      updateSyncMeta("majors", cleanedMajors.length, "local-sync-client");

      safeLog("admin-sync-success", { key: "majors", count: cleanedMajors.length });

      return res.json({
        success: true,
        message: "Majors synced",
        rawCount,
        savedCount: cleanedMajors.length,
        skippedCount,
        generatedCodeCount,
        version
      });

    } catch (err) {
      console.error('[sync/majors] failed:', err);
      return res.status(500).json({
        success: false,
        message: "Failed to save majors cache",
        detail: err.message,
        hint: "检查 server/storage 权限或数据结构"
      });
    }
  }
);

// 3. 同步 Class Schedules (支持 merge 增量合并与 replace 全量覆盖)
router.post(
  "/sync/class-schedules",
  verifyAdminWriteAccess,
  (req, res) => {
    const rawPayload = req.body;
    const { schedules, semester: payloadSemester } = parseClassSchedulesPayload(rawPayload);
    const mode = req.query.mode || "merge"; // 默认增量合并模式

    if (!Array.isArray(schedules)) {
      return res.status(400).json({
        success: false,
        message: "请求体不能为空，且必须是行政班级课表数组",
      });
    }

    if (containsSensitiveData(rawPayload)) {
      safeLog("sensitive-data-blocked", { type: "class-schedules" });
      return res.status(400).json({
        success: false,
        message: "数据中包含敏感词，已被拒绝写入",
      });
    }

    try {
      const filePath = FILE_MAP["class-schedules"];
      const fallbackSemester = payloadSemester || getFallbackSemester();
      const normalizedPayload = normalizeClassScheduleList(schedules, fallbackSemester);
      let finalData = [];

      if (mode === "merge" && fs.existsSync(filePath)) {
        try {
          const existingData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (Array.isArray(existingData)) {
            // 建立 semester + collegeCode + grade + majorCode + className 的稳定唯一 key
            const map = new Map();
            const touchedMajorKeys = new Set(normalizedPayload.map(getClassScheduleMajorKey));
            const payloadMajorInfo = new Map();
            normalizedPayload.forEach((item) => {
              const majorKey = getClassScheduleMajorKey(item);
              const info = payloadMajorInfo.get(majorKey) || { hasAdminClass: false };
              info.hasAdminClass = info.hasAdminClass || (!item.isAggregated && item.displayType !== "major-schedule");
              payloadMajorInfo.set(majorKey, info);
            });
            normalizeClassScheduleList(existingData, fallbackSemester).forEach((item) => {
              const majorKey = getClassScheduleMajorKey(item);
              const sameMajorUploaded = touchedMajorKeys.has(majorKey);
              const incomingInfo = payloadMajorInfo.get(majorKey) || {};
              const staleUnreliableClass =
                sameMajorUploaded &&
                !item.isAggregated &&
                item.displayType !== "major-schedule" &&
                !scheduleNormalizer.isReliableClassName(item.className, { courses: item.courses });
              const staleAggregate =
                sameMajorUploaded &&
                incomingInfo.hasAdminClass &&
                (item.isAggregated || item.displayType === "major-schedule");
              if (staleUnreliableClass) {
                return;
              }
              if (staleAggregate) {
                return;
              }
              map.set(getClassScheduleCompositeKey(item), item);
            });
            // 用 payload 里的数据去覆盖或新增
            normalizedPayload.forEach((item) => {
              map.set(getClassScheduleCompositeKey(item), item);
            });
            finalData = Array.from(map.values());
          } else {
            finalData = normalizedPayload;
          }
        } catch (e) {
          console.error("Failed to parse existing class-schedules.json, fallback to rewrite", e);
          finalData = normalizedPayload;
        }
      } else {
        // replace 模式或者原文件不存在
        finalData = normalizedPayload;
      }

      fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2), "utf-8");
      
      const count = finalData.length;
      updateSyncMeta("class-schedules", count, "local-sync-client");

      safeLog("admin-sync-success", { key: "class-schedules", count, mode });

      return res.json({
        success: true,
        message: `数据同步成功 (${mode === 'merge' ? '增量合并' : '全量覆盖'})`,
        updatedAt: new Date().toISOString(),
        itemCount: count,
        uploadedCount: normalizedPayload.length
      });
    } catch (error) {
      safeLog("admin-sync-failed", { key: "class-schedules", error: error.message });
      return res.status(500).json({
        success: false,
        message: `数据持久化失败: ${error.message}`,
      });
    }
  }
);

// 4. 同步 Teacher Schedules
router.post(
  "/sync/teacher-schedules",
  verifyAdminWriteAccess,
  createSyncHandler("teacher-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 5. 同步 Classroom Schedules
router.post(
  "/sync/classroom-schedules",
  verifyAdminWriteAccess,
  createSyncHandler("classroom-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 6. 同步 Course Schedules
router.post(
  "/sync/course-schedules",
  verifyAdminWriteAccess,
  createSyncHandler("course-schedules", (data) => {
    return Array.isArray(data);
  })
);

router.post(
  "/sync/resources",
  verifyAdminWriteAccess,
  (req, res) => {
    const resourceType = String(req.query.type || req.body.resourceType || "").trim();
    const key = RESOURCE_FILE_BY_TYPE[resourceType];
    if (!key) {
      return res.status(400).json({
        success: false,
        message: "type must be teacher, classroom, or course",
      });
    }

    const body = Array.isArray(req.body) ? { items: req.body } : (req.body || {});
    const items = body.items;
    if (!Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        message: "resources payload must be an array or { items: [] }",
      });
    }
    if (containsSensitiveData(req.body)) {
      safeLog("sensitive-data-blocked", { type: key });
      return res.status(400).json({
        success: false,
        message: "数据中包含敏感字段，已拒绝写入",
      });
    }

    try {
      return res.json(stageResourceChunk(resourceType, key, body, items));
    } catch (error) {
      safeLog("admin-sync-resources-failed", { key, error: error.message });
      return res.status(error.statusCode || 500).json({
        success: false,
        message: `resources persist failed: ${error.message}`,
      });
    }
  }
);

function getActiveSnapshotMeta() {
  const currentJsonPath = path.join(SNAPSHOTS_DIR, "current.json");
  if (!fs.existsSync(currentJsonPath)) {
    return null;
  }
  try {
    const stat = fs.statSync(currentJsonPath);
    if (!global.cachedSnapshotMeta || global.cachedSnapshotMeta.mtime !== stat.mtimeMs) {
      const content = fs.readFileSync(currentJsonPath, "utf-8");
      const snapshot = JSON.parse(content);
      global.cachedSnapshotMeta = {
        mtime: stat.mtimeMs,
        updatedAt: snapshot.updatedAt,
        version: snapshot.version,
        semester: snapshot.semester,
        collegesCount: snapshot.coverage?.collegeCount ?? (snapshot.catalog?.colleges?.length ?? 0),
        majorsCount: snapshot.coverage?.majorCount ?? (snapshot.majors?.length ?? 0),
        classScheduleCount: snapshot.coverage?.classScheduleCount ?? (snapshot.classSchedules?.length ?? 0),
        adminClassCount: snapshot.coverage?.adminClassCount ?? 0,
        majorAggregateCount: snapshot.coverage?.majorAggregateCount ?? 0,
        teacherScheduleCount: snapshot.coverage?.teacherScheduleCount ?? (snapshot.resources?.teacherSchedules?.length ?? 0),
        classroomScheduleCount: snapshot.coverage?.classroomScheduleCount ?? (snapshot.resources?.classroomSchedules?.length ?? 0),
        courseScheduleCount: snapshot.coverage?.courseScheduleCount ?? (snapshot.resources?.courseSchedules?.length ?? 0),
      };
    }
    return global.cachedSnapshotMeta;
  } catch (error) {
    console.error("Failed to read current snapshot metadata:", error);
    return null;
  }
}

router.post(
  "/release/upload",
  verifyAdminWriteAccess,
  express.raw({ type: "*/*", limit: "150mb" }),
  (req, res) => {
    try {
      const parsed = releaseService.parseSnapshotBuffer(req.body || Buffer.alloc(0));
      const written = releaseService.writeReleaseSnapshot(parsed.snapshot);
      return res.json({
        success: true,
        message: "release uploaded and validated",
        version: written.version,
        semester: written.manifest.semester,
        counts: written.manifest.counts,
        size: parsed.size,
        isGzip: parsed.isGzip,
      });
    } catch (error) {
      const validation = error.validation;
      safeLog("release-upload-failed", { error: error.message, validation });
      return res.status(validation ? 400 : 500).json({
        success: false,
        message: validation ? "release validation failed" : error.message,
        errors: validation ? validation.errors : undefined,
      });
    }
  }
);

router.post(
  "/release/activate",
  verifyAdminWriteAccess,
  (req, res) => {
    try {
      let result;
      if (req.body && req.body.snapshot) {
        result = releaseService.activateReleaseFromSnapshot(req.body.snapshot);
      } else {
        result = releaseService.activateReleaseVersion(req.body && req.body.version);
      }
      const status = releaseService.getReleaseStatus();
      global.cachedSnapshotMeta = null;
      global.cachedSnapshotData = null;

      const meta = getSyncMeta();
      const counts = status.counts || {};
      const updatedAt = status.activeReleaseUpdatedAt || new Date().toISOString();
      meta.snapshot = {
        updatedAt,
        version: status.activeReleaseVersion,
        semester: status.semester,
        itemCount: counts.classScheduleCount || 0,
        syncSource: "local-sync-client",
      };
      meta.catalog = {
        updatedAt,
        itemCount: counts.collegeCount || counts.collegesCount || 0,
        syncSource: "local-sync-client",
      };
      meta.majors = {
        updatedAt,
        itemCount: counts.majorCount || counts.majorsCount || 0,
        syncSource: "local-sync-client",
      };
      meta["class-schedules"] = {
        updatedAt,
        itemCount: counts.classScheduleCount || 0,
        adminClassCount: counts.adminClassCount || 0,
        majorAggregateCount: counts.majorAggregateCount || 0,
        syncSource: "local-sync-client",
      };
      meta["teacher-schedules"] = {
        updatedAt,
        itemCount: counts.teacherScheduleCount || 0,
        syncSource: "local-sync-client",
      };
      meta["classroom-schedules"] = {
        updatedAt,
        itemCount: counts.classroomScheduleCount || 0,
        syncSource: "local-sync-client",
      };
      meta["course-schedules"] = {
        updatedAt,
        itemCount: counts.courseScheduleCount || 0,
        syncSource: "local-sync-client",
      };
      fs.writeFileSync(FILE_MAP["sync-meta"], JSON.stringify(meta, null, 2), "utf-8");
      appConfigService.touchDataVersionForSyncKey("release", {
        updatedAt,
        releaseVersion: status.activeReleaseVersion,
        semester: status.semester,
        releaseNote: "全校课表数据已更新",
      });

      return res.json({
        success: true,
        message: "release activated",
        version: status.activeReleaseVersion,
        semester: status.semester,
        counts: status.counts,
        validation: result.validation,
      });
    } catch (error) {
      const validation = error.validation;
      safeLog("release-activate-failed", { error: error.message, validation });
      return res.status(error.statusCode || (validation ? 400 : 500)).json({
        success: false,
        message: validation ? "release validation failed" : error.message,
        errors: validation ? validation.errors : undefined,
      });
    }
  }
);

router.get("/release/status", verifyAdminWriteAccess, (req, res) => {
  res.json({
    success: true,
    ...releaseService.getReleaseStatus(),
  });
});

router.get("/release/list", verifyAdminWriteAccess, (req, res) => {
  res.json({
    success: true,
    releases: releaseService.listReleases(req.query.limit),
  });
});

// 6.5. 上传快照临时文件
router.post(
  "/snapshot/upload",
  verifyAdminWriteAccess,
  express.raw({ type: "*/*", limit: "150mb" }),
  async (req, res) => {
    try {
      const buffer = req.body;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ success: false, message: "上传内容不能为空" });
      }

      // Check magic bytes for gzip: 1f 8b
      const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
      let jsonStr;
      
      if (isGzip) {
        try {
          jsonStr = zlib.gunzipSync(buffer).toString("utf-8");
        } catch (err) {
          return res.status(400).json({ success: false, message: "无效的 Gzip 压缩数据: " + err.message });
        }
      } else {
        jsonStr = buffer.toString("utf-8");
      }

      // Verify valid JSON
      let snapshotData;
      try {
        snapshotData = JSON.parse(jsonStr);
      } catch (err) {
        return res.status(400).json({ success: false, message: "解析 JSON 失败，数据可能损坏: " + err.message });
      }

      const tempJsonPath = path.join(SNAPSHOTS_DIR, "temp_upload.json");
      const tempGzPath = path.join(SNAPSHOTS_DIR, "temp_upload.json.gz");

      if (isGzip) {
        fs.writeFileSync(tempGzPath, buffer);
        fs.writeFileSync(tempJsonPath, jsonStr, "utf-8");
      } else {
        fs.writeFileSync(tempJsonPath, jsonStr, "utf-8");
        const gzBuffer = zlib.gzipSync(Buffer.from(jsonStr, "utf-8"));
        fs.writeFileSync(tempGzPath, gzBuffer);
      }

      return res.json({
        success: true,
        message: "快照上传成功，暂存在临时文件，请调用 activate 接口激活",
        isGzip,
        size: buffer.length,
        version: snapshotData.version,
        semester: snapshotData.semester
      });
    } catch (error) {
      console.error("Snapshot upload failed:", error);
      return res.status(500).json({ success: false, message: "上传处理失败: " + error.message });
    }
  }
);

// 6.6. 激活临时文件为正式快照
router.post(
  "/snapshot/activate",
  verifyAdminWriteAccess,
  async (req, res) => {
    try {
      const tempJsonPath = path.join(SNAPSHOTS_DIR, "temp_upload.json");
      const tempGzPath = path.join(SNAPSHOTS_DIR, "temp_upload.json.gz");

      if (!fs.existsSync(tempJsonPath) || !fs.existsSync(tempGzPath)) {
        return res.status(400).json({ success: false, message: "未找到待激活的快照临时文件，请先上传" });
      }

      const jsonStr = fs.readFileSync(tempJsonPath, "utf-8");
      const snapshot = JSON.parse(jsonStr);

      if (!snapshot.version || !snapshot.semester || !snapshot.catalog || !snapshot.majors || !snapshot.classSchedules) {
        return res.status(400).json({ success: false, message: "快照数据校验失败：缺少关键快照属性" });
      }

      const classSchedulesCount = snapshot.classSchedules.length;
      const collegesCount = snapshot.catalog.colleges ? snapshot.catalog.colleges.length : 0;
      const majorsCount = snapshot.majors.length;
      const teacherScheduleCount = snapshot.resources?.teacherSchedules?.length || 0;
      const classroomScheduleCount = snapshot.resources?.classroomSchedules?.length || 0;
      const courseScheduleCount = snapshot.resources?.courseSchedules?.length || 0;

      if (classSchedulesCount <= 0) {
        return res.status(400).json({ success: false, message: "快照校验失败：classSchedules 数量必须大于 0" });
      }
      if (collegesCount <= 0) {
        return res.status(400).json({ success: false, message: "快照校验失败：catalog.colleges 数量必须大于 0" });
      }
      if (majorsCount <= 0) {
        return res.status(400).json({ success: false, message: "快照校验失败：majors 数量必须大于 0" });
      }

      const currentJsonPath = path.join(SNAPSHOTS_DIR, "current.json");
      const currentGzPath = path.join(SNAPSHOTS_DIR, "current.json.gz");

      if (fs.existsSync(currentGzPath)) {
        const timestamp = Date.now();
        let oldSemester = snapshot.semester;
        try {
          if (fs.existsSync(currentJsonPath)) {
            const oldSnapshot = JSON.parse(fs.readFileSync(currentJsonPath, "utf-8"));
            oldSemester = oldSnapshot.semester || oldSemester;
          }
        } catch (e) {}

        const backupGzPath = path.join(HISTORY_DIR, `snapshot-${oldSemester}-${timestamp}.json.gz`);
        fs.copyFileSync(currentGzPath, backupGzPath);
        console.log(`[Snapshot] Old snapshot backed up to: ${backupGzPath}`);

        try {
          const files = fs.readdirSync(HISTORY_DIR)
            .filter(f => f.startsWith("snapshot-") && f.endsWith(".json.gz"))
            .map(f => ({ name: f, path: path.join(HISTORY_DIR, f), time: fs.statSync(path.join(HISTORY_DIR, f)).mtimeMs }));
          
          if (files.length > 5) {
            files.sort((a, b) => a.time - b.time);
            const toDeleteCount = files.length - 5;
            for (let i = 0; i < toDeleteCount; i++) {
              fs.unlinkSync(files[i].path);
              console.log(`[Snapshot] Deleted old history file: ${files[i].path}`);
            }
          }
        } catch (err) {
          console.error("Failed to clean snapshot history:", err);
        }
      }

      fs.renameSync(tempJsonPath, currentJsonPath);
      fs.renameSync(tempGzPath, currentGzPath);

      global.cachedSnapshotMeta = null;
      global.cachedSnapshotData = null;

      const nowStr = new Date().toISOString();
      const meta = getSyncMeta();
      meta["snapshot"] = {
        updatedAt: nowStr,
        version: snapshot.version,
        semester: snapshot.semester,
        itemCount: classSchedulesCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["catalog"] = {
        updatedAt: nowStr,
        itemCount: collegesCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["majors"] = {
        updatedAt: nowStr,
        itemCount: majorsCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["class-schedules"] = {
        updatedAt: nowStr,
        itemCount: classSchedulesCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["teacher-schedules"] = {
        updatedAt: nowStr,
        itemCount: teacherScheduleCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["classroom-schedules"] = {
        updatedAt: nowStr,
        itemCount: classroomScheduleCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["course-schedules"] = {
        updatedAt: nowStr,
        itemCount: courseScheduleCount,
        syncSource: snapshot.source || "local-sync-client",
      };

      fs.writeFileSync(FILE_MAP["sync-meta"], JSON.stringify(meta, null, 2), "utf-8");
      appConfigService.touchDataVersionForSyncKey("snapshot", {
        updatedAt: nowStr,
        releaseVersion: snapshot.version,
        semester: snapshot.semester,
        releaseNote: "全校课表数据已更新",
      });

      return res.json({
        success: true,
        message: "快照激活成功，系统已切换至最新快照",
        version: snapshot.version,
        semester: snapshot.semester,
        counts: {
          collegesCount,
          majorsCount,
          classScheduleCount: classSchedulesCount,
          teacherScheduleCount,
          classroomScheduleCount,
          courseScheduleCount
        }
      });
    } catch (error) {
      console.error("Snapshot activation failed:", error);
      return res.status(500).json({ success: false, message: "激活失败: " + error.message });
    }
  }
);

// 7. 获取当前缓存状态
router.get("/sync/status", verifyAdminWriteAccess, (req, res) => {
  const meta = getSyncMeta();
  const snapshotMeta = getActiveSnapshotMeta();
  const releaseStatus = releaseService.getReleaseStatus();
  const feedbackStats = feedbackService.getFeedbackStats();
  const resourcesUpdatedAt = getUpdatedAt("teacher-schedules") || getUpdatedAt("classroom-schedules") || getUpdatedAt("course-schedules") || (snapshotMeta ? snapshotMeta.updatedAt : null);
  const teacherScheduleCount = getItemCount("teacher-schedules") || (snapshotMeta ? snapshotMeta.teacherScheduleCount : 0);
  const classroomScheduleCount = getItemCount("classroom-schedules") || (snapshotMeta ? snapshotMeta.classroomScheduleCount : 0);
  const courseScheduleCount = getItemCount("course-schedules") || (snapshotMeta ? snapshotMeta.courseScheduleCount : 0);
  const semester = snapshotMeta ? snapshotMeta.semester : (meta.snapshot ? meta.snapshot.semester : "2025-2026-2");
  const classSchedulesUpdatedAt = getUpdatedAt("class-schedules");
  const relayUploads = relayService.listUploads();
  const latestRelayUpload = relayUploads[0] || null;
  const payload = {
    dataSourceMode: config.DATA_SOURCE_MODE,
    activeReleaseVersion: releaseStatus.activeReleaseVersion,
    activeReleaseUpdatedAt: releaseStatus.activeReleaseUpdatedAt,
    activeReleaseActivatedAt: releaseStatus.activeReleaseActivatedAt,
    snapshotUpdatedAt: snapshotMeta ? snapshotMeta.updatedAt : (meta.snapshot ? meta.snapshot.updatedAt : null),
    snapshotVersion: snapshotMeta ? snapshotMeta.version : (meta.snapshot ? meta.snapshot.version : null),
    releaseVersion: releaseStatus.activeReleaseVersion || (meta.snapshot ? meta.snapshot.version : "-"),
    semester,
    collegesCount: snapshotMeta ? snapshotMeta.collegesCount : getItemCount("catalog"),
    majorsCount: snapshotMeta ? snapshotMeta.majorsCount : getItemCount("majors"),
    classScheduleCount: snapshotMeta ? snapshotMeta.classScheduleCount : getItemCount("class-schedules"),
    adminClassCount: snapshotMeta ? snapshotMeta.adminClassCount : 0,
    majorAggregateCount: snapshotMeta ? snapshotMeta.majorAggregateCount : 0,
    teacherScheduleCount,
    classroomScheduleCount,
    courseScheduleCount,
    resourcesUpdatedAt,
    resourcesVersion: snapshotMeta ? snapshotMeta.version : (releaseStatus.activeReleaseVersion || (meta.snapshot ? meta.snapshot.version : null)),
    feedbackCount: feedbackStats.total,
    openFeedbackCount: feedbackStats.open,
    catalogUpdatedAt: getUpdatedAt("catalog"),
    classSchedulesUpdatedAt,
    classScheduleUpdatedAt: classSchedulesUpdatedAt,
    teacherScheduleUpdatedAt: getUpdatedAt("teacher-schedules"),
    classroomScheduleUpdatedAt: getUpdatedAt("classroom-schedules"),
    courseScheduleUpdatedAt: getUpdatedAt("course-schedules"),
    lastUploadTime: classSchedulesUpdatedAt || resourcesUpdatedAt || (snapshotMeta ? snapshotMeta.updatedAt : null),
    intranetAccessible: false,
    intranetMessage: "公网服务器无法访问学校内网是预期情况；主流程请在校园网电脑或接力代理端采集。",
    latestRelayUpload,
    storageMounted: isStorageMounted(),
    storagePath: STORAGE_DIR,
    metaDetails: meta,
    adminSessionAuthenticated: adminAuth.isAdminRequest(req),
    apiTokenConfigured: Boolean(config.ADMIN_API_TOKEN),
  };
  payload.counts = {
    collegeCount: payload.collegesCount || 0,
    majorCount: payload.majorsCount || 0,
    classScheduleCount: payload.classScheduleCount || 0,
    adminClassCount: payload.adminClassCount || 0,
    majorAggregateCount: payload.majorAggregateCount || 0,
    teacherScheduleCount: payload.teacherScheduleCount || 0,
    classroomScheduleCount: payload.classroomScheduleCount || 0,
    courseScheduleCount: payload.courseScheduleCount || 0,
  };

  res.json({
    success: true,
    data: payload,
    ...payload,
  });
});

// 8. 管理员审核贡献接口
// POST /api/admin/review/contributions
router.post(
  "/review/contributions",
  verifyAdminWriteAccess,
  (req, res) => {
    const { id, action } = req.body;
    if (!id || !action) {
      return res.status(400).json({
        success: false,
        message: "id 和 action 参数是必需的",
      });
    }

    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({
        success: false,
        message: "action 必须是 'approve' 或 'reject'",
      });
    }

    try {
      // 1. 读取贡献数据
      let contributions = [];
      const contribPath = FILE_MAP["contributions"];
      if (fs.existsSync(contribPath)) {
        contributions = JSON.parse(fs.readFileSync(contribPath, "utf-8"));
      }

      const index = contributions.findIndex((c) => c.id === id);
      if (index === -1) {
        return res.status(404).json({
          success: false,
          message: "找不到该贡献记录",
        });
      }

      const contrib = contributions[index];
      
      if (action === "reject") {
        contrib.reviewed = true;
        contrib.rejected = true;
        contrib.updatedAt = new Date().toISOString();
        fs.writeFileSync(contribPath, JSON.stringify(contributions, null, 2), "utf-8");
        return res.json({
          success: true,
          message: "已成功拒绝该贡献课表",
        });
      }

      // 2. approve 合并逻辑
      contrib.reviewed = true;
      contrib.rejected = false;
      contrib.updatedAt = new Date().toISOString();

      const classSchedPath = FILE_MAP["class-schedules"];
      let classSchedules = [];
      if (fs.existsSync(classSchedPath)) {
        classSchedules = JSON.parse(fs.readFileSync(classSchedPath, "utf-8"));
      }

      // 查找相同班级的课表进行覆盖，或者追加
      const classIndex = classSchedules.findIndex(
        (c) => c.className === contrib.className
      );

      const targetClassSchedule = {
        className: contrib.className,
        collegeCode: contrib.collegeCode || "",
        collegeName: contrib.collegeName || "",
        grade: contrib.grade || "",
        majorCode: contrib.majorCode || "",
        majorName: contrib.majorName || "",
        courses: contrib.courses,
      };

      if (classIndex >= 0) {
        classSchedules[classIndex] = targetClassSchedule;
        console.log(`[Review] 已覆盖已有的班级课表: ${contrib.className}`);
      } else {
        classSchedules.push(targetClassSchedule);
        console.log(`[Review] 已追加新班级课表: ${contrib.className}`);
      }

      // 3. 写入文件
      fs.writeFileSync(classSchedPath, JSON.stringify(classSchedules, null, 2), "utf-8");
      fs.writeFileSync(contribPath, JSON.stringify(contributions, null, 2), "utf-8");

      // 4. 更新同步元数据
      updateSyncMeta("class-schedules", classSchedules.length, "user-contribution");

      return res.json({
        success: true,
        message: "贡献审核通过，课表已成功合并进公共缓存",
        className: contrib.className,
      });

    } catch (error) {
      safeLog("review-contribution-failed", { error: error.message });
      return res.status(500).json({
        success: false,
        message: `审核处理失败: ${error.message}`,
      });
    }
  }
);

router.get("/dashboard", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const dashboardData = appConfigService.getAdminDashboard();
    if (dashboardData.success && dashboardData.data) {
      const heatmap = resolveClassroomHeatmapData();
      dashboardData.data.classroomHeatmap = heatmap.classroomHeatmap;
      dashboardData.data.classroomHeatmapCounts = heatmap.classroomHeatmapCounts;
      dashboardData.data.classroomHeatmapDetails = heatmap.classroomHeatmapDetails;
      dashboardData.data.classroomHeatmapMeta = heatmap.classroomHeatmapMeta;
      dashboardData.data.collegeDistribution = buildCollegeDistribution();
    }
    return res.json(dashboardData);
  } catch (error) {
    safeLog("admin-dashboard-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/classroom-heatmap", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { semester, week, building } = req.query;
    const heatmap = resolveClassroomHeatmapData({ semester, week, building });
    return res.json({
      success: true,
      data: heatmap
    });
  } catch (error) {
    safeLog("admin-classroom-heatmap-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/config", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      data: appConfigService.getAdminConfig(),
      publicConfig: appConfigService.getPublicAppConfig().data,
    });
  } catch (error) {
    safeLog("admin-config-get-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/config", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("config", appConfigService.CONFIG_PATH);
    const result = appConfigService.saveAdminConfig(req.body || {});
    writeAuditLog(req, "save", "config", "admin-config", "保存系统配置并应用");
    return res.json({
      success: true,
      data: result,
      publicConfig: appConfigService.getPublicAppConfig().data,
    });
  } catch (error) {
    safeLog("admin-config-save-failed", { error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/notices", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      items: appConfigService.listNotices(),
    });
  } catch (error) {
    safeLog("admin-notices-list-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/notices", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("notices", appConfigService.NOTICES_PATH);
    const item = appConfigService.createNotice(req.body || {});
    writeAuditLog(req, "create", "notices", item.id, `创建公告: ${item.title}`);
    return res.json({
      success: true,
      item,
    });
  } catch (error) {
    safeLog("admin-notice-create-failed", { error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.put("/notices/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("notices", appConfigService.NOTICES_PATH);
    const item = appConfigService.updateNotice(req.params.id, req.body || {});
    writeAuditLog(req, "update", "notices", req.params.id, `编辑公告: ${item.title}`);
    return res.json({
      success: true,
      item,
    });
  } catch (error) {
    safeLog("admin-notice-update-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.delete("/notices/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("notices", appConfigService.NOTICES_PATH);
    const deleted = appConfigService.deleteNotice(req.params.id);
    writeAuditLog(req, "delete", "notices", req.params.id, `删除公告 id: ${req.params.id}`);
    return res.json({
      success: true,
      deleted,
    });
  } catch (error) {
    safeLog("admin-notice-delete-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/news", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      items: appConfigService.listNews(),
    });
  } catch (error) {
    safeLog("admin-news-list-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/news", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("news", appConfigService.NEWS_PATH);
    const item = appConfigService.createNews(req.body || {});
    writeAuditLog(req, "create", "news", item.id, `创建动态: ${item.title}`);
    return res.json({
      success: true,
      item,
    });
  } catch (error) {
    safeLog("admin-news-create-failed", { error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.put("/news/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("news", appConfigService.NEWS_PATH);
    const item = appConfigService.updateNews(req.params.id, req.body || {});
    writeAuditLog(req, "update", "news", req.params.id, `编辑动态: ${item.title}`);
    return res.json({
      success: true,
      item,
    });
  } catch (error) {
    safeLog("admin-news-update-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.delete("/news/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("news", appConfigService.NEWS_PATH);
    const deleted = appConfigService.deleteNews(req.params.id);
    writeAuditLog(req, "delete", "news", req.params.id, `删除动态 id: ${req.params.id}`);
    return res.json({
      success: true,
      deleted,
    });
  } catch (error) {
    safeLog("admin-news-delete-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/feedbacks", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const overview = feedbackService.getFeedbackOverview();
    const items = feedbackService.listFeedback(req.query);
    return res.json({
      success: true,
      items,
      total: items.length,
      stats: overview.stats,
      types: overview.types,
    });
  } catch (error) {
    safeLog("admin-feedbacks-list-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/feedbacks/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const feedbackFile = path.join(STORAGE_DIR, "feedbacks.json");
    createBackup("feedback", feedbackFile);
    const record = feedbackService.updateFeedbackReview(req.params.id, req.body || {});
    writeAuditLog(req, "update", "feedback", req.params.id, `编辑反馈备注及状态: ${req.body.status || record.status}`);
    return res.json({
      success: true,
      item: record,
      stats: feedbackService.getFeedbackStats(),
    });
  } catch (error) {
    safeLog("admin-feedbacks-update-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/feedback", verifyAdminToken, (req, res) => {
  try {
    const overview = feedbackService.getFeedbackOverview();
    const feedback = feedbackService.listFeedback(req.query);
    return res.json({
      success: true,
      feedback,
      items: feedback,
      total: feedback.length,
      stats: overview.stats,
      types: overview.types,
      filters: {
        limit: req.query.limit || "100",
        status: req.query.status || "",
        type: req.query.type || "",
        keyword: req.query.keyword || "",
        days: req.query.days || "",
      },
    });
  } catch (error) {
    safeLog("admin-feedback-list-failed", { error: error.message });
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/feedback/export.csv", verifyAdminToken, (req, res) => {
  try {
    const csv = feedbackService.exportFeedbackCsv(req.query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="fosu-feedback-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    safeLog("admin-feedback-export-failed", { error: error.message });
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/feedback/:id", verifyAdminToken, (req, res) => {
  try {
    return res.json({
      success: true,
      feedback: feedbackService.getFeedbackById(req.params.id),
    });
  } catch (error) {
    safeLog("admin-feedback-detail-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * 数据质量检测中心检测核心逻辑
 */
function generateQualityReport() {
  const classes = readJsonArray(FILE_MAP["class-schedules"]);
  const teachers = readJsonArray(FILE_MAP["teacher-schedules"]);
  const classrooms = readJsonArray(FILE_MAP["classroom-schedules"]);
  
  let totalCoursesCount = 0;
  let missingTeacher = 0;
  let missingClassroom = 0;
  let missingWeeks = 0;
  let missingSections = 0;
  let duplicateCount = 0;
  let emptyClassSchedules = 0;
  let abnormalLessCourses = 0;
  
  const anomalies = [];
  
  let ignores = [];
  try {
    if (fs.existsSync(QUALITY_IGNORES_PATH)) {
      ignores = JSON.parse(fs.readFileSync(QUALITY_IGNORES_PATH, "utf-8"));
    }
  } catch (e) {}
  
  const isIgnored = (type, target) => Array.isArray(ignores) && ignores.some(ig => ig.type === type && ig.target === target);

  classes.forEach(c => {
    const className = c.className || "";
    const courses = c.courses || [];
    totalCoursesCount += courses.length;
    
    if (courses.length === 0) {
      emptyClassSchedules++;
      if (!isIgnored("empty-schedule", className)) {
        anomalies.push({
          type: "empty-schedule",
          target: className,
          original: "课表无课程安排数据",
          suggestion: "核实班级是否本学期确无课，或重新同步",
          severity: "warning"
        });
      }
    } else if (courses.length < 3) {
      abnormalLessCourses++;
      if (!isIgnored("few-courses", className)) {
        anomalies.push({
          type: "few-courses",
          target: className,
          original: `课程数量较少: 仅 ${courses.length} 门课`,
          suggestion: "核查该班级排课数据是否解析完整",
          severity: "info"
        });
      }
    }
    
    const timeSlots = {};
    courses.forEach(course => {
      if (!course.courseName) {
        if (!isIgnored("missing-coursename", className)) {
          anomalies.push({
            type: "missing-coursename",
            target: className,
            original: "包含空的课程名称",
            suggestion: "核对并补充该课程的名称",
            severity: "danger"
          });
        }
      }
      if (!course.teacherName) {
        missingTeacher++;
        if (!isIgnored("missing-teacher", `${className}:${course.courseName}`)) {
          anomalies.push({
            type: "missing-teacher",
            target: `${className}:${course.courseName}`,
            original: `课程《${course.courseName}》缺少授课教师`,
            suggestion: "补充授课教师姓名或填写'见通知'",
            severity: "info"
          });
        }
      }
      if (!course.classroom) {
        missingClassroom++;
        if (!isIgnored("missing-classroom", `${className}:${course.courseName}`)) {
          anomalies.push({
            type: "missing-classroom",
            target: `${className}:${course.courseName}`,
            original: `课程《${course.courseName}》缺少上课教室`,
            suggestion: "补充上课课室名称",
            severity: "warning"
          });
        }
      }
      
      const weeks = course.weeks || [];
      const sections = course.sections || [];
      const day = course.dayOfWeek || course.weekday || 0;
      
      if (weeks.length === 0) missingWeeks++;
      if (sections.length === 0) missingSections++;
      
      weeks.forEach(w => {
        sections.forEach(s => {
          const key = `${w}_${day}_${s}`;
          if (timeSlots[key] && timeSlots[key] !== course.courseName) {
            duplicateCount++;
            const targetKey = `${className}:${key}`;
            if (!isIgnored("class-conflict", targetKey)) {
              anomalies.push({
                type: "class-conflict",
                target: targetKey,
                original: `班级课表第 ${w} 周星期 ${day} 第 ${s} 节课程重叠: 《${timeSlots[key]}》与《${course.courseName}》`,
                suggestion: "确认是否为合班课、多地点可选课程，或解析数据重叠",
                severity: "danger"
              });
            }
          }
          timeSlots[key] = course.courseName;
        });
      });
    });
  });

  teachers.forEach(t => {
    const teacherName = t.teacherName || "";
    const courses = t.courses || [];
    const timeSlots = {};
    courses.forEach(course => {
      const weeks = course.weeks || [];
      const sections = course.sections || [];
      const day = course.dayOfWeek || course.weekday || 0;
      const room = course.classroom || "未知";
      
      weeks.forEach(w => {
        sections.forEach(s => {
          const key = `${w}_${day}_${s}`;
          if (timeSlots[key] && timeSlots[key] !== room) {
            const targetKey = `${teacherName}:${key}`;
            if (!isIgnored("teacher-conflict", targetKey)) {
              anomalies.push({
                type: "teacher-conflict",
                target: targetKey,
                original: `教师冲突: 同一时间在 [${timeSlots[key]}] 与 [${room}] 均有上课安排`,
                suggestion: "检查教师是否同时被派往两地授课",
                severity: "danger"
              });
            }
          }
          timeSlots[key] = room;
        });
      });
    });
  });

  classrooms.forEach(c => {
    const roomName = c.roomName || c.classroom || "";
    if (!roomName) return;
    const courses = c.courses || [];
    const timeSlots = {};
    courses.forEach(course => {
      const weeks = course.weeks || [];
      const sections = course.sections || [];
      const day = course.dayOfWeek || course.weekday || 0;
      const desc = `${course.teacherName || "未知"}:${course.className || "未知"}`;
      
      weeks.forEach(w => {
        sections.forEach(s => {
          const key = `${w}_${day}_${s}`;
          if (timeSlots[key] && timeSlots[key] !== desc) {
            const targetKey = `${roomName}:${key}`;
            if (!isIgnored("classroom-conflict", targetKey)) {
              anomalies.push({
                type: "classroom-conflict",
                target: targetKey,
                original: `教室冲突: 同一时间被 [${timeSlots[key]}] 和 [${desc}] 重叠使用`,
                suggestion: "核实该教室是否为多班合课，或发生撞室排错",
                severity: "danger"
              });
            }
          }
          timeSlots[key] = desc;
        });
      });
    });
  });

  return {
    stats: {
      totalCoursesCount,
      missingTeacher,
      missingClassroom,
      missingWeeks,
      missingSections,
      duplicateCount,
      emptyClassSchedules,
      abnormalLessCourses,
      anomalyCount: anomalies.length
    },
    anomalies
  };
}

function getCatalogMeta() {
  try {
    if (fs.existsSync(CATALOG_META_PATH)) {
      return JSON.parse(fs.readFileSync(CATALOG_META_PATH, "utf-8"));
    }
  } catch (e) {}
  return {};
}

function saveCatalogMeta(meta) {
  try {
    writeJsonAtomic(CATALOG_META_PATH, meta);
  } catch (e) {
    safeLog("save-catalog-meta-failed", { error: e.message });
  }
}

/**
 * 1. GET /api/admin/catalog/stats
 * 数据资源指标统计
 */
router.get("/catalog/stats", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const snapshot = getActiveSnapshotDataSafe();
    const catalog = snapshot?.catalog || readJsonFile(FILE_MAP.catalog, { colleges: [], semesters: [], grades: [] });
    const classes = getResourceArrayWithSource("class-schedules").items;
    const teachers = getResourceArrayWithSource("teacher-schedules").items;
    const classrooms = getResourceArrayWithSource("classroom-schedules").items;
    const courses = getResourceArrayWithSource("course-schedules").items;
    
    const meta = getAdminDataVersion();
    
    return res.json({
      success: true,
      data: {
        classCount: classes.length,
        teacherCount: teachers.length,
        classroomCount: classrooms.length,
        courseCount: courses.length,
        collegeCount: (catalog.colleges || []).length,
        semesterCount: (catalog.semesters || []).length,
        gradeCount: (catalog.grades || []).length,
        currentSemester: catalog.semesters?.[0]?.value || "2025-2026-2",
        updatedAt: meta.classScheduleUpdatedAt || new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 2. GET /api/admin/catalog/list
 * 数据分类列表查询 (行政班、教师、教室、课程、学院专业、原始快照)
 */
router.get("/catalog/list", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, semester, keyword, page = 1, pageSize = 20 } = req.query;
    const limit = parseInt(pageSize, 10);
    const offset = (parseInt(page, 10) - 1) * limit;
    const kw = String(keyword || "").trim().toLowerCase();
    
    const catMeta = getCatalogMeta();
    let list = [];
    
    if (type === "class") {
      const raw = getResourceArrayWithSource("class-schedules").items;
      list = raw.map(item => {
        const metaInfo = catMeta[`class::${item.className}`] || {};
        return {
          id: item.className,
          className: item.className,
          collegeName: item.collegeName || "其他",
          majorName: item.majorName || "通用",
          grade: item.grade || "-",
          semester: item.semester || semester || "-",
          coursesCount: (item.courses || []).length,
          displayName: metaInfo.displayName || "",
          note: metaInfo.note || "",
          hidden: !!metaInfo.hidden,
          tags: metaInfo.tags || []
        };
      });
      if (semester) {
        list = list.filter(x => x.semester === semester);
      }
      if (kw) {
        list = list.filter(x => 
          x.className.toLowerCase().includes(kw) || 
          x.collegeName.toLowerCase().includes(kw) || 
          x.majorName.toLowerCase().includes(kw) ||
          (x.displayName && x.displayName.toLowerCase().includes(kw))
        );
      }
    } else if (type === "teacher") {
      const raw = getResourceArrayWithSource("teacher-schedules").items;
      list = raw.map(item => {
        const metaInfo = catMeta[`teacher::${item.teacherName}`] || {};
        const classes = Array.from(new Set((item.courses || []).map(c => c.className).filter(Boolean)));
        return {
          id: item.teacherName,
          teacherName: item.teacherName,
          collegeName: item.collegeName || "教务系统",
          semester: item.semester || semester || "-",
          coursesCount: (item.courses || []).length,
          classesCount: classes.length,
          displayName: metaInfo.displayName || "",
          note: metaInfo.note || "",
          hidden: !!metaInfo.hidden,
          tags: metaInfo.tags || []
        };
      });
      if (semester) {
        list = list.filter(x => x.semester === semester);
      }
      if (kw) {
        list = list.filter(x => 
          x.teacherName.toLowerCase().includes(kw) || 
          x.collegeName.toLowerCase().includes(kw) ||
          (x.displayName && x.displayName.toLowerCase().includes(kw))
        );
      }
    } else if (type === "classroom") {
      const raw = getResourceArrayWithSource("classroom-schedules").items;
      list = raw.map(item => {
        const metaInfo = catMeta[`classroom::${item.roomName}`] || {};
        const count = (item.courses || []).length;
        const sectionsSet = new Set();
        (item.courses || []).forEach(c => {
          (c.weeks || []).forEach(w => {
            (c.sections || []).forEach(s => {
              sectionsSet.add(`${w}_${c.dayOfWeek || c.weekday}_${s}`);
            });
          });
        });
        const occupationRate = Math.min(100, Math.round((sectionsSet.size / 98) * 100)); // 估算 7天*14节 = 98节 为满额
        
        let buildingName = "其他";
        const buildingMatch = item.roomName.match(/^([^\d]+)/);
        if (buildingMatch) {
          buildingName = buildingMatch[1].trim();
        }
        
        return {
          id: item.roomName,
          roomName: item.roomName,
          buildingName,
          semester: item.semester || semester || "-",
          coursesCount: count,
          occupationRate: `${occupationRate}%`,
          displayName: metaInfo.displayName || "",
          note: metaInfo.note || "",
          hidden: !!metaInfo.hidden,
          tags: metaInfo.tags || []
        };
      });
      if (semester) {
        list = list.filter(x => x.semester === semester);
      }
      if (kw) {
        list = list.filter(x => 
          x.roomName.toLowerCase().includes(kw) || 
          x.buildingName.toLowerCase().includes(kw) ||
          (x.displayName && x.displayName.toLowerCase().includes(kw))
        );
      }
    } else if (type === "course") {
      const raw = getResourceArrayWithSource("course-schedules").items;
      list = raw.map(item => {
        const metaInfo = catMeta[`course::${item.courseName}`] || {};
        const teachers = Array.from(new Set((item.courses || []).map(c => c.teacherName).filter(Boolean)));
        const classes = Array.from(new Set((item.courses || []).map(c => c.className).filter(Boolean)));
        const classrooms = Array.from(new Set((item.courses || []).map(c => c.classroom).filter(Boolean)));
        return {
          id: item.courseName,
          courseName: item.courseName,
          collegeName: item.collegeName || "教务公开课",
          semester: item.semester || semester || "-",
          teachersCount: teachers.length,
          classesCount: classes.length,
          classroomsCount: classrooms.length,
          displayName: metaInfo.displayName || "",
          note: metaInfo.note || "",
          hidden: !!metaInfo.hidden,
          tags: metaInfo.tags || []
        };
      });
      if (semester) {
        list = list.filter(x => x.semester === semester);
      }
      if (kw) {
        list = list.filter(x => 
          x.courseName.toLowerCase().includes(kw) || 
          x.collegeName.toLowerCase().includes(kw) ||
          (x.displayName && x.displayName.toLowerCase().includes(kw))
        );
      }
    } else if (type === "major") {
      const majorsPayload = readJsonFile(path.join(STORAGE_DIR, "majors-index.json"), { colleges: [] });
      const flat = [];
      (majorsPayload.colleges || []).forEach(college => {
        (college.grades || []).forEach(gradeItem => {
          (gradeItem.majors || []).forEach(m => {
            flat.push({
              collegeCode: college.collegeCode,
              collegeName: college.collegeName,
              grade: gradeItem.grade,
              majorCode: m.majorCode,
              majorName: m.majorName,
              semester: majorsPayload.semester || "-"
            });
          });
        });
      });
      list = flat;
      if (kw) {
        list = list.filter(x => 
          x.majorName.toLowerCase().includes(kw) || 
          x.collegeName.toLowerCase().includes(kw) || 
          x.grade.includes(kw)
        );
      }
    } else if (type === "snapshot") {
      const snapFiles = fs.existsSync(SNAPSHOTS_DIR) ? fs.readdirSync(SNAPSHOTS_DIR) : [];
      list = snapFiles
        .filter(f => f.endsWith(".json"))
        .map(f => {
          const stat = fs.statSync(path.join(SNAPSHOTS_DIR, f));
          return {
            id: f,
            filename: f,
            size: `${Math.round(stat.size / 1024)} KB`,
            createdAt: stat.mtime.toISOString(),
            type: f.includes("normalized") ? "标准化后" : "教务快照"
          };
        });
      if (kw) {
        list = list.filter(x => x.filename.toLowerCase().includes(kw));
      }
    }
    
    const paginated = list.slice(offset, offset + limit);
    
    return res.json({
      success: true,
      items: paginated,
      total: list.length,
      page: parseInt(page, 10),
      pageSize: limit
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 3. GET /api/admin/catalog/detail
 * 获取单项资源的原始和可视化预览数据
 */
router.get("/catalog/detail", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, id } = req.query;
    if (!type || !id) {
      return res.status(400).json({ success: false, message: "缺少必要参数 type 或 id" });
    }
    
    let original = null;
    const catMeta = getCatalogMeta();
    const metaKey = `${type}::${id}`;
    const metaInfo = catMeta[metaKey] || {};
    
    if (type === "class") {
      const raw = getResourceArrayWithSource("class-schedules").items;
      original = raw.find(x => x.className === id);
    } else if (type === "teacher") {
      const raw = getResourceArrayWithSource("teacher-schedules").items;
      original = raw.find(x => x.teacherName === id);
    } else if (type === "classroom") {
      const raw = getResourceArrayWithSource("classroom-schedules").items;
      original = raw.find(x => x.roomName === id);
    } else if (type === "course") {
      const raw = getResourceArrayWithSource("course-schedules").items;
      original = raw.find(x => x.courseName === id);
    }
    
    if (!original) {
      return res.status(404).json({ success: false, message: "资源未找到" });
    }
    
    return res.json({
      success: true,
      data: {
        id,
        type,
        metaInfo,
        original,
        courses: original.courses || []
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 4. POST /api/admin/catalog/meta
 * 修改资源别名、备注、标记隐藏、置顶等
 */
router.post("/catalog/meta", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, id, displayName, note, hidden, tags } = req.body;
    if (!type || !id) {
      return res.status(400).json({ success: false, message: "缺少必要参数 type 或 id" });
    }
    
    createBackup("catalog-meta", CATALOG_META_PATH);
    const catMeta = getCatalogMeta();
    const key = `${type}::${id}`;
    
    catMeta[key] = {
      displayName: String(displayName || "").trim(),
      note: String(note || "").trim(),
      hidden: !!hidden,
      tags: Array.isArray(tags) ? tags : [],
      updatedAt: new Date().toISOString()
    };
    
    saveCatalogMeta(catMeta);
    writeAuditLog(req, "update", "catalog-meta", key, `修改数据资源 [${type}] ${id} 的元数据别名和备注`);
    
    return res.json({ success: true, message: "修改成功", metaInfo: catMeta[key] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

const STAGING_LATEST_PATH = path.join(STORAGE_DIR, "staging-latest.json");

function getStagingIncludeScopes(data) {
  const scopes = data?.meta?.includeScopes;
  return Array.isArray(scopes) ? scopes : [];
}

function getStagingClassSchedules(data) {
  return data?.classSchedules || data?.resources?.classSchedules || [];
}

function summarizeStagingData(data) {
  const classSchedules = getStagingClassSchedules(data);
  const resources = data?.resources || {};
  const adminClassCount = classSchedules.filter((item) => item.displayType === "class-schedule" && !item.isAggregated).length;
  const counts = {
    classScheduleCount: classSchedules.length,
    adminClassCount,
    majorAggregateCount: classSchedules.length - adminClassCount,
    teacherScheduleCount: resources.teacherSchedules?.length || data?.teacherSchedules?.length || 0,
    classroomScheduleCount: resources.classroomSchedules?.length || data?.classroomSchedules?.length || 0,
    courseScheduleCount: resources.courseSchedules?.length || data?.courseSchedules?.length || 0,
    classroomCount: resources.classrooms?.length || data?.classrooms?.length || 0,
    teacherCount: resources.teachers?.length || data?.teachers?.length || 0,
    courseCount: resources.courses?.length || data?.courses?.length || 0,
    collegeCount: data?.catalog?.colleges?.length || data?.colleges?.length || 0,
    gradeCount: data?.catalog?.grades?.length || data?.grades?.length || 0,
  };
  return { classSchedules, counts };
}

function areStagingCountsAllZero(counts) {
  return Object.values(counts || {}).every((value) => Number(value || 0) === 0);
}

function validateStagingData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") {
    errors.push("Staging 数据必须是 JSON 对象");
    return { valid: false, errors, warnings };
  }

  const requiredFields = ["schemaVersion", "releaseVersion", "term", "termStartDate", "generatedAt"];
  requiredFields.forEach(f => {
    if (!data[f]) {
      errors.push(`缺少关键元数据字段: ${f}`);
    }
  });

  const includeScopes = getStagingIncludeScopes(data);
  const hasClassSchedules = includeScopes.length === 0 || includeScopes.includes("classSchedules");
  const { classSchedules, counts } = summarizeStagingData(data);

  // 支持在 resources 内部或顶层
  if (hasClassSchedules) {
    if (!classSchedules || !Array.isArray(classSchedules) || classSchedules.length === 0) {
      errors.push("缺少班级课程表数据 (classSchedules)");
    } else {
      classSchedules.forEach((item, index) => {
        if (index < 5) {
          if (!item.className) {
            warnings.push(`classSchedules[${index}] 缺少 className 字段`);
          }
        }
      });
    }
  }

  if (areStagingCountsAllZero(counts)) {
    errors.push("Staging 数据计数全部为 0，疑似空包，禁止暂存或发布");
  }

  if (data.meta?.counts) {
    const reportedClassCount = Number(data.meta.counts.classScheduleCount || 0);
    if (hasClassSchedules && reportedClassCount === 0 && classSchedules.length > 0) {
      warnings.push("meta.counts.classScheduleCount 为 0，但实际 classSchedules 非空；已按实际数据重新计算");
    }
  }

  const cacheUsage = data.meta?.cacheUsage || {};
  if (data.meta?.usedClassScheduleCache || cacheUsage.usedClassScheduleCache) {
    warnings.push(`本次 Staging 使用了历史 classSchedules 缓存: ${data.meta?.cacheSource || cacheUsage.cacheSource || "未知来源"}`);
  }
  if (data.meta?.cacheWarning || cacheUsage.cacheWarning) {
    warnings.push(data.meta?.cacheWarning || cacheUsage.cacheWarning);
  }

  const resourceKeys = [
    "teacherSchedules",
    "classroomSchedules",
    "courseSchedules",
    "classrooms",
    "teachers",
    "courses"
  ];
  resourceKeys.forEach(k => {
    const list = data[k] || data.resources?.[k];
    if (!list || !Array.isArray(list)) {
      warnings.push(`缺少资源维度数据: ${k}`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function buildStagingSafety(data, activeSnapshot) {
  const includeScopes = getStagingIncludeScopes(data);
  const hasClassSchedules = includeScopes.length === 0 || includeScopes.includes("classSchedules");
  const { counts } = summarizeStagingData(data);
  const validation = validateStagingData(data);
  const blockers = validation.errors.slice();
  const warnings = validation.warnings.slice();
  const activeCounts = activeSnapshot ? releaseService.countRelease(activeSnapshot) : {};
  const activeClassCount = activeCounts.classScheduleCount || (activeSnapshot?.classSchedules || []).length;
  const currentTerm = appConfigService.getAdminConfig().currentSemester || "";
  const stagingTerm = data.term || data.semester || "";
  const releaseVersion = data.releaseVersion || data.version || "";
  const releaseVersionExists = Boolean(
    releaseVersion &&
    releaseService.listReleases(200).some((item) => item.version === releaseVersion)
  );
  const riskDrops = [];
  let maxDropRate = 0;
  let severeDrop = false;

  [
    { key: "classScheduleCount", label: "行政班课表变化" },
    { key: "teacherScheduleCount", label: "教师课表变化" },
    { key: "classroomScheduleCount", label: "教室课表变化" },
    { key: "courseScheduleCount", label: "课程课表变化" },
  ].forEach((item) => {
    const activeCount = Number(activeCounts[item.key] || 0);
    const stagingCount = Number(counts[item.key] || 0);
    if (!activeSnapshot || activeCount <= 0 || stagingCount >= activeCount) {
      return;
    }
    const dropRate = (activeCount - stagingCount) / activeCount;
    if (dropRate <= 0.3) {
      return;
    }
    const dropPercent = parseFloat((dropRate * 100).toFixed(2));
    maxDropRate = Math.max(maxDropRate, dropRate);
    if (dropRate > 0.5) {
      severeDrop = true;
    }
    riskDrops.push({
      key: item.key,
      label: item.label,
      activeCount,
      stagingCount,
      dropPercent,
      severity: dropRate > 0.5 ? "danger" : "warning",
    });
    warnings.push(
      `${item.label}: 线上 ${activeCount} -> Staging ${stagingCount}，下降 ${dropPercent}%` +
      (dropRate > 0.5 ? "，默认禁止发布，必须勾选强制确认。" : "，请核对是否为正常新学期变化。")
    );
  });

  if (hasClassSchedules && counts.classScheduleCount === 0 && !blockers.includes("缺少班级课程表数据 (classSchedules)")) {
    blockers.push("includeScopes 包含 classSchedules，但 classSchedules=0");
  }
  if (!data.term) {
    blockers.push("term 为空");
  }
  if (!data.releaseVersion) {
    blockers.push("releaseVersion 为空");
  }
  if (areStagingCountsAllZero(counts)) {
    blockers.push("counts 全部为 0");
  }
  if (currentTerm && stagingTerm && currentTerm !== stagingTerm) {
    warnings.push(`Staging 学期 ${stagingTerm} 与当前后台配置学期 ${currentTerm} 不一致，请确认不是误传旧学期数据。`);
  }
  if (releaseVersionExists) {
    warnings.push(`releaseVersion ${releaseVersion} 已存在，发布会覆盖同名版本快照，必须二次确认。`);
  }

  return {
    allowPublish: blockers.length === 0,
    requiresForceConfirm: severeDrop || releaseVersionExists,
    blockers,
    warnings,
    counts,
    activeCounts,
    riskDrops,
    activeClassScheduleCount: activeClassCount,
    classScheduleDropRate: parseFloat(Math.max(0, maxDropRate * 100).toFixed(2)),
    currentTerm,
    stagingTerm,
    releaseVersionExists,
  };
}

/**
 * Relay Agent: 管理员创建与审核接力采集任务。
 */
function buildAdminStagingUploadActor(req) {
  return {
    type: "admin",
    id: adminAuth.isAdminRequest(req) ? "admin-session" : "admin-token",
  };
}

function buildStagingUploadSummary(stagingData, safety, extra = {}) {
  return Object.assign({
    term: stagingData.term || stagingData.semester || "",
    releaseVersion: stagingData.releaseVersion || stagingData.version || "",
    generatedAt: stagingData.generatedAt || stagingData.updatedAt || "",
    counts: safety?.counts || summarizeStagingData(stagingData).counts,
  }, extra);
}

router.get("/staging/upload", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      uploads: stagingUploadService.listUploads(req.query.limit || 20),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/staging/status", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const uploads = stagingUploadService.listUploads(req.query.limit || 50);
    const pendingReview = uploads.filter((item) => item.status === "pending-review");
    return res.json({
      success: true,
      uploads,
      pendingReview,
      latest: uploads[0] || null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/staging/:uploadId", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const deleted = stagingUploadService.deleteUpload(req.params.uploadId, buildAdminStagingUploadActor(req));
    if (deleted && deleted.status === "pending-review" && fs.existsSync(STAGING_LATEST_PATH)) {
      fs.unlinkSync(STAGING_LATEST_PATH);
    }
    writeAuditLog(req, "delete", "staging-upload", req.params.uploadId, "删除 Staging 上传记录");
    return res.json({ success: true, message: "Staging 上传记录已删除", deleted });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/staging/upload/init", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const upload = stagingUploadService.initUpload(req.body || {}, buildAdminStagingUploadActor(req));
    return res.json({
      success: true,
      uploadId: upload.uploadId,
      upload,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post(
  "/staging/upload/chunk",
  adminAuth.verifyAdminAccess,
  express.raw({ type: "*/*", limit: "12mb" }),
  (req, res) => {
    try {
      const uploadId = req.query.uploadId || req.headers["x-upload-id"];
      const chunkIndex = req.query.chunkIndex || req.headers["x-chunk-index"];
      const status = stagingUploadService.writeChunk(
        uploadId,
        chunkIndex,
        req.body,
        buildAdminStagingUploadActor(req),
        { chunkSha256: req.headers["x-chunk-sha256"] }
      );
      return res.json({ success: true, upload: status });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }
);

router.post("/staging/upload/finalize", adminAuth.verifyAdminAccess, async (req, res) => {
  const uploadId = req.body && req.body.uploadId;
  try {
    const finalized = await stagingUploadService.finalizeUpload(uploadId, buildAdminStagingUploadActor(req), req.body || {});
    let stagingData = stagingUploadService.normalizeStagingData(finalized.stagingData);
    stagingData.stagingUploadId = finalized.manifest.uploadId;
    stagingData.meta = Object.assign({}, stagingData.meta || {}, {
      stagingUploadId: finalized.manifest.uploadId,
      stagingUploadStatus: "pending-review",
    });

    const validation = validateStagingData(stagingData);
    if (!validation.valid) {
      stagingUploadService.markUploadFailed(uploadId, validation.errors.join("; "));
      return res.status(400).json({
        success: false,
        message: "Staging JSON validation failed",
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    writeJsonAtomic(STAGING_LATEST_PATH, stagingData);
    const activeSnapshot = releaseService.readActiveReleaseSnapshot();
    const safety = buildStagingSafety(stagingData, activeSnapshot);
    const summary = buildStagingUploadSummary(stagingData, safety, {
      warnings: safety.warnings,
      blockers: safety.blockers,
    });
    const upload = stagingUploadService.markUploadPendingReview(uploadId, summary);
    writeAuditLog(req, "upload", "staging-upload", uploadId, `CLI chunk upload finalized: ${stagingData.term || ""}`);

    return res.json({
      success: true,
      message: "Staging upload finalized and queued for review",
      stagingId: uploadId,
      upload,
      data: {
        term: stagingData.term,
        termStartDate: stagingData.termStartDate,
        releaseVersion: stagingData.releaseVersion,
        generatedAt: stagingData.generatedAt,
        counts: safety.counts,
        safety,
      },
      warnings: validation.warnings.concat(safety.warnings || []),
    });
  } catch (error) {
    stagingUploadService.markUploadFailed(uploadId, error.message);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/staging/upload/:uploadId/status", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const status = stagingUploadService.getUploadStatus(req.params.uploadId, buildAdminStagingUploadActor(req));
    return res.json({ success: true, upload: status });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/relay/tasks", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const task = relayService.createTask(req.body || {});
    writeAuditLog(req, "create", "relay-task", task.id, `创建接力任务 ${task.term}`);
    return res.json({
      success: true,
      message: "接力任务已创建",
      task,
      runCommand: `npm run sync:relay-agent -- --server=${req.protocol}://${req.get("host")} --token=${task.relayToken} --term=${task.term}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/relay/tasks", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      tasks: relayService.listTasks(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/relay/tasks/:id/revoke", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const task = relayService.revokeTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "接力任务不存在" });
    }
    writeAuditLog(req, "revoke", "relay-task", req.params.id, "吊销接力任务 token");
    return res.json({ success: true, message: "接力任务已吊销", task });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/relay/tasks/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const deleted = relayService.deleteTask(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "接力任务不存在" });
    }
    writeAuditLog(req, "delete", "relay-task", req.params.id, "删除接力任务记录");
    return res.json({ success: true, message: "接力任务已删除", deleted: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/relay/uploads", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      uploads: relayService.listUploads(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/relay/uploads/:id/promote-to-staging", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const uploadResult = relayService.readUploadPayload(req.params.id);
    if (!uploadResult) {
      return res.status(404).json({ success: false, message: "接力上传记录不存在或文件已丢失" });
    }

    const stagingData = relayService.normalizeStagingData(uploadResult.payload, {
      taskId: uploadResult.upload.taskId,
      uploadId: uploadResult.upload.id,
      uploaderNote: uploadResult.upload.uploaderNote,
    });
    const validation = validateStagingData(stagingData);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: "接力上传无法提升为 Staging，数据校验不通过",
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    writeJsonAtomic(STAGING_LATEST_PATH, stagingData);
    const upload = relayService.markUploadStaged(req.params.id);
    writeAuditLog(req, "promote", "relay-upload", req.params.id, `将接力上传设为当前 Staging: ${stagingData.term}`);

    return res.json({
      success: true,
      message: "接力上传已提升为当前 Staging，请继续核对 diff 后发布",
      upload,
      warnings: validation.warnings,
      summary: relayService.summarizeStagingData(stagingData),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5. GET /api/admin/sync/status
 * 获取同步中心状态及健康度检查 (带教务网DNS解析测试)
 */
router.get("/sync/status", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const meta = getAdminDataVersion();
    const syncMeta = getSyncMeta();
    
    // 快速进行 EasyConnect / 教务网 DNS 解析诊断 (1秒超时)
    const dns = require("dns").promises;
    let intranetAccessible = false;
    try {
      const hostname = new URL(config.FOSU_BASE_URL || "https://100.fosu.edu.cn").hostname;
      const lookupPromise = dns.lookup(hostname);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1000));
      await Promise.race([lookupPromise, timeoutPromise]);
      intranetAccessible = true;
    } catch (e) {
      intranetAccessible = false;
    }

    const relayUploads = relayService.listUploads();
    const stagingUploads = stagingUploadService.listUploads(1);
    const activeInfo = releaseService.getActiveReleaseInfo();
    const releasePackStatus = activeInfo && activeInfo.version
      ? releaseService.getReleasePackStatus(activeInfo.version)
      : null;
    return res.json({
      success: true,
      data: {
        releaseVersion: meta.releaseVersion || "-",
        semester: appConfigService.getAdminConfig().currentSemester,
        releasePackStatus,
        releasePackHealthy: Boolean(releasePackStatus && releasePackStatus.healthy),
        classScheduleUpdatedAt: syncMeta["class-schedules"]?.updatedAt || null,
        teacherScheduleUpdatedAt: syncMeta["teacher-schedules"]?.updatedAt || null,
        classroomScheduleUpdatedAt: syncMeta["classroom-schedules"]?.updatedAt || null,
        courseScheduleUpdatedAt: syncMeta["course-schedules"]?.updatedAt || null,
        lastUploadTime: syncMeta["class-schedules"]?.updatedAt || syncMeta["sync-meta"]?.updatedAt || null,
        intranetAccessible,
        intranetMessage: intranetAccessible
          ? "当前服务器 DNS 能解析教务域名，但主流程仍建议使用本机校园网采集。"
          : "公网服务器无法访问学校内网是预期情况；请使用本机校园网同步或接力代理端。",
        latestRelayUpload: relayUploads[0] || null,
        latestStagingUpload: stagingUploads[0] || null,
        counts: {
          classScheduleCount: syncMeta["class-schedules"]?.itemCount || 0,
          adminClassCount: syncMeta["class-schedules"]?.adminClassCount || 0,
          majorAggregateCount: syncMeta["class-schedules"]?.majorAggregateCount || 0,
          teacherScheduleCount: syncMeta["teacher-schedules"]?.itemCount || 0,
          classroomScheduleCount: syncMeta["classroom-schedules"]?.itemCount || 0,
          courseScheduleCount: syncMeta["course-schedules"]?.itemCount || 0,
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5.1 POST /api/admin/sync/staging/upload
 * 上传 Staging JSON 数据包并校验，仅写入 staging 不激活
 */
router.post(
  "/sync/staging/upload",
  adminAuth.verifyAdminAccess,
  express.raw({ type: "*/*", limit: "150mb" }),
  async (req, res) => {
    try {
      const buffer = req.body;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ success: false, message: "上传内容不能为空" });
      }

      const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
      let jsonStr;
      
      if (isGzip) {
        try {
          jsonStr = zlib.gunzipSync(buffer).toString("utf-8");
        } catch (err) {
          return res.status(400).json({ success: false, message: "无效的 Gzip 压缩数据: " + err.message });
        }
      } else {
        jsonStr = buffer.toString("utf-8");
      }

      let stagingData;
      try {
        stagingData = JSON.parse(jsonStr);
      } catch (err) {
        return res.status(400).json({ success: false, message: "解析 JSON 失败，数据可能损坏: " + err.message });
      }

      // 规范化字段位置
      if (!stagingData.classSchedules && stagingData.resources?.classSchedules) {
        stagingData.classSchedules = stagingData.resources.classSchedules;
      }
      if (!stagingData.resources) {
        stagingData.resources = {
          teacherSchedules: stagingData.teacherSchedules || [],
          classroomSchedules: stagingData.classroomSchedules || [],
          courseSchedules: stagingData.courseSchedules || [],
          classrooms: stagingData.classrooms || [],
          teachers: stagingData.teachers || [],
          courses: stagingData.courses || [],
        };
      }

      const validation = validateStagingData(stagingData);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: "Staging JSON 格式校验不通过",
          errors: validation.errors,
          warnings: validation.warnings
        });
      }

      // 写入暂存区
      fs.writeFileSync(STAGING_LATEST_PATH, JSON.stringify(stagingData, null, 2), "utf-8");
      
      const activeSnapshot = releaseService.readActiveReleaseSnapshot();
      const safety = buildStagingSafety(stagingData, activeSnapshot);

      return res.json({
        success: true,
        message: "Staging JSON 上传并校验成功，已暂存",
        warnings: safety.warnings,
        data: {
          term: stagingData.term,
          termStartDate: stagingData.termStartDate,
          releaseVersion: stagingData.releaseVersion,
          generatedAt: stagingData.generatedAt,
          meta: stagingData.meta || null,
          counts: safety.counts,
          safety,
        }
      });
    } catch (error) {
      console.error("Staging upload failed:", error);
      return res.status(500).json({ success: false, message: "上传处理失败: " + error.message });
    }
  }
);

/**
 * 5.2 GET /api/admin/sync/staging/current
 * 获取当前 Staging 的预览与线上版本对比差异统计
 */
router.get("/sync/staging/current", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    if (!fs.existsSync(STAGING_LATEST_PATH)) {
      return res.json({ success: false, message: "暂无暂存的 Staging 数据，请先上传" });
    }

    const stagingData = JSON.parse(fs.readFileSync(STAGING_LATEST_PATH, "utf-8"));
    const activeSnapshot = releaseService.readActiveReleaseSnapshot();

    const getStats = (snapshot) => {
      if (!snapshot) return { classCount: 0, courseCount: 0, teacherCount: 0, classroomCount: 0, classNames: [] };
      const classSchedules = snapshot.classSchedules || [];
      const classNames = classSchedules.map(c => c.className).filter(Boolean);
      return {
        classCount: classSchedules.length,
        courseCount: snapshot.resources?.courses?.length || snapshot.resources?.courseSchedules?.length || 0,
        teacherCount: snapshot.resources?.teachers?.length || snapshot.resources?.teacherSchedules?.length || 0,
        classroomCount: snapshot.resources?.classrooms?.length || snapshot.resources?.classroomSchedules?.length || 0,
        classNames
      };
    };

    const stagingStats = getStats(stagingData);
    const activeStats = getStats(activeSnapshot);

    const stagingClassNamesSet = new Set(stagingStats.classNames);
    const activeClassNamesSet = new Set(activeStats.classNames);

    const deletedClasses = activeStats.classNames.filter(name => !stagingClassNamesSet.has(name));
    const addedClasses = stagingStats.classNames.filter(name => !activeClassNamesSet.has(name));

    const baseCount = Math.max(activeStats.classCount, 1);
    const changeRate = (deletedClasses.length + addedClasses.length) / baseCount;
    const isBigChange = changeRate > 0.3;

    const { counts } = summarizeStagingData(stagingData);
    const safety = buildStagingSafety(stagingData, activeSnapshot);

    return res.json({
      success: true,
      data: {
        term: stagingData.term,
        termStartDate: stagingData.termStartDate,
        releaseVersion: stagingData.releaseVersion,
        generatedAt: stagingData.generatedAt,
        releaseNote: stagingData.releaseNote || "",
        meta: stagingData.meta || null,
        counts,
        safety,
        diff: {
          classDelta: stagingStats.classCount - activeStats.classCount,
          courseDelta: stagingStats.courseCount - activeStats.courseCount,
          teacherDelta: stagingStats.teacherCount - activeStats.teacherCount,
          classroomDelta: stagingStats.classroomCount - activeStats.classroomCount,
          deletedClasses: deletedClasses.slice(0, 100),
          deletedCount: deletedClasses.length,
          addedClasses: addedClasses.slice(0, 100),
          addedCount: addedClasses.length,
          changeRate: parseFloat((changeRate * 100).toFixed(2)),
          isBigChange,
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5.3 POST /api/admin/sync/staging/publish
 * 发布当前 Staging JSON 为正式 Release (变动>30%需要force强制参数)
 */
router.post("/sync/staging/publish", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    if (!fs.existsSync(STAGING_LATEST_PATH)) {
      return res.status(400).json({ success: false, message: "暂存数据不存在，请先上传 Staging JSON" });
    }

    const stagingData = JSON.parse(fs.readFileSync(STAGING_LATEST_PATH, "utf-8"));
    const activeSnapshot = releaseService.readActiveReleaseSnapshot();
    const safety = buildStagingSafety(stagingData, activeSnapshot);
    const forcePublish = req.body.force === true;

    if (!safety.allowPublish) {
      return res.status(400).json({
        success: false,
        code: "STAGING_SAFETY_BLOCKED",
        message: "Staging 数据未通过发布安全校验，禁止发布。",
        blockers: safety.blockers,
        warnings: safety.warnings,
      });
    }

    if (safety.requiresForceConfirm && !forcePublish) {
      const riskText = (safety.riskDrops || [])
        .map((item) => `${item.label}下降 ${item.dropPercent}%（线上 ${item.activeCount}，Staging ${item.stagingCount}）`)
        .join("；");
      return res.status(400).json({
        success: false,
        code: "CLASS_COUNT_DROP_BLOCKED",
        message: riskText
          ? `${riskText}，必须二次确认后才能发布。`
          : "候选 releaseVersion 已存在或数据风险较高，必须二次确认后才能发布。",
        safety,
      });
    }

    // 变动率限制校验
    if (activeSnapshot) {
      const activeClassNames = (activeSnapshot.classSchedules || []).map(c => c.className).filter(Boolean);
      const stagingClassNamesSet = new Set((stagingData.classSchedules || []).map(c => c.className).filter(Boolean));
      
      const deletedClasses = activeClassNames.filter(name => !stagingClassNamesSet.has(name));
      const addedClasses = (stagingData.classSchedules || []).map(c => c.className).filter(name => name && !new Set(activeClassNames).has(name));
      
      const baseCount = Math.max(activeClassNames.length, 1);
      const changeRate = (deletedClasses.length + addedClasses.length) / baseCount;
      
      if (changeRate > 0.5 && !forcePublish) {
        return res.status(400).json({
          success: false,
          code: "BIG_CHANGE_BLOCKED",
          message: `Staging 数据变动率达 ${parseFloat((changeRate * 100).toFixed(2))}% (超过 50% 安全熔断值)。为避免新学期数据丢失或覆盖线上，必须勾选“确认强制发布”后方可提交发布。`,
        });
      }
    }

    // 备份当前线上版本
    const activeInfo = releaseService.getActiveReleaseInfo();
    if (activeInfo && activeInfo.version) {
      const activeFiles = releaseService.getReleaseFiles(activeInfo.version);
      if (fs.existsSync(activeFiles.snapshotPath)) {
        createBackup("release-snapshot", activeFiles.snapshotPath);
      }
    }

    // 正式激活发布
    const result = releaseService.activateReleaseFromSnapshot(stagingData);
    
    // 更新元数据
    const status = releaseService.getReleaseStatus();
    const counts = status.counts || {};
    const updatedAt = new Date().toISOString();
    const meta = getSyncMeta();
    meta.snapshot = {
      updatedAt,
      version: status.activeReleaseVersion,
      semester: status.semester,
      itemCount: counts.classScheduleCount || 0,
      syncSource: "local-sync-client",
    };
    meta.catalog = {
      updatedAt,
      itemCount: counts.collegeCount || counts.collegesCount || 0,
      syncSource: "local-sync-client",
    };
    meta.majors = {
      updatedAt,
      itemCount: counts.majorCount || counts.majorsCount || 0,
      syncSource: "local-sync-client",
    };
    meta["class-schedules"] = {
      updatedAt,
      itemCount: counts.classScheduleCount || 0,
      adminClassCount: counts.adminClassCount || 0,
      majorAggregateCount: counts.majorAggregateCount || 0,
      syncSource: "local-sync-client",
    };
    meta["teacher-schedules"] = {
      updatedAt,
      itemCount: counts.teacherScheduleCount || 0,
      syncSource: "local-sync-client",
    };
    meta["classroom-schedules"] = {
      updatedAt,
      itemCount: counts.classroomScheduleCount || 0,
      syncSource: "local-sync-client",
    };
    meta["course-schedules"] = {
      updatedAt,
      itemCount: counts.courseScheduleCount || 0,
      syncSource: "local-sync-client",
    };
    fs.writeFileSync(FILE_MAP["sync-meta"], JSON.stringify(meta, null, 2), "utf-8");

    // 更新配置中发布版本号，使小程序端生效
    appConfigService.touchDataVersionForSyncKey("release", {
      updatedAt,
      releaseVersion: status.activeReleaseVersion,
      semester: status.semester,
      releaseNote: req.body.releaseNote || stagingData.releaseNote || "通过管理端 Staging 校验发布新版本"
    });

    writeAuditLog(req, "publish", "sync-release", status.activeReleaseVersion, `将 Staging 数据正式发布为版本 ${status.activeReleaseVersion}`);
    if (stagingData.stagingUploadId) {
      stagingUploadService.markUploadPublished(stagingData.stagingUploadId, status.activeReleaseVersion);
    }
    if (stagingData.relayUploadId) {
      relayService.markUploadPublished(stagingData.relayUploadId, status.activeReleaseVersion);
    }

    // Clear old memory cache
    releaseService.clearDerivedCache();

    // Rebuild and pre-warm indices for the active release
    let indexBuildResult = { success: true, count: 0 };
    try {
      const kinds = ["class", "teacher", "classroom", "course"];
      let totalItems = 0;
      kinds.forEach((kind) => {
        const warmed = releaseService.readActiveIndex(kind, status.activeReleaseVersion);
        if (warmed && warmed.success) {
          totalItems += (warmed.items || []).length;
        } else {
          throw new Error(`Failed to build index for ${kind}: ${warmed ? warmed.reasonCode : 'unknown'}`);
        }
      });
      const emptyRoomIndex = releaseService.readEmptyRoomIndex(status.activeReleaseVersion);
      if (emptyRoomIndex && emptyRoomIndex.success) {
        totalItems += (emptyRoomIndex.rooms || []).length;
      } else {
        throw new Error(`Failed to build empty-room index: ${emptyRoomIndex ? emptyRoomIndex.reasonCode : 'unknown'}`);
      }
      indexBuildResult.count = totalItems;
    } catch (indexErr) {
      console.error("Failed to build index on publish:", indexErr);
      indexBuildResult = { success: false, error: indexErr.message };
    }

    if (!indexBuildResult.success) {
      return res.status(500).json({
        success: false,
        message: "发布成功但索引构建失败：" + indexBuildResult.error,
        version: status.activeReleaseVersion,
        semester: status.semester,
        counts,
        indexBuildResult
      });
    }

    return res.json({
      success: true,
      message: "Staging 新版本已成功发布上线！",
      version: status.activeReleaseVersion,
      releaseVersion: status.activeReleaseVersion,
      term: status.semester,
      semester: status.semester,
      counts,
      indexBuildResult
    });
  } catch (error) {
    console.error("Staging publish failed:", error);
    return res.status(500).json({ success: false, message: "发布失败: " + error.message });
  }
});

/**
 * 5.4 GET /api/admin/sync/releases
 * 获取最近发布的历史 Release 快照版本列表 (限 10 条，用于回滚)
 */
router.get("/sync/releases", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const list = releaseService.listReleases(10);
    return res.json({
      success: true,
      releases: list,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5.5 POST /api/admin/sync/releases/rollback
 * 一键回滚到指定的历史版本
 */
router.post("/sync/releases/rollback", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const version = req.body.version;
    if (!version) {
      return res.status(400).json({ success: false, message: "缺少必要参数 version" });
    }

    // 备份当前活跃快照 (在回滚前)
    const activeInfo = releaseService.getActiveReleaseInfo();
    if (activeInfo && activeInfo.version) {
      const activeFiles = releaseService.getReleaseFiles(activeInfo.version);
      if (fs.existsSync(activeFiles.snapshotPath)) {
        createBackup("release-snapshot", activeFiles.snapshotPath);
      }
    }

    const result = releaseService.activateReleaseVersion(version);

    // 触碰版本，同步更新缓存
    const status = releaseService.getReleaseStatus();
    const counts = status.counts || {};
    const updatedAt = new Date().toISOString();
    const meta = getSyncMeta();
    Object.keys(meta).forEach(key => {
      if (meta[key] && typeof meta[key] === "object") {
        meta[key].updatedAt = updatedAt;
        meta[key].version = version;
      }
    });
    fs.writeFileSync(FILE_MAP["sync-meta"], JSON.stringify(meta, null, 2), "utf-8");

    appConfigService.touchDataVersionForSyncKey("release", {
      updatedAt,
      releaseVersion: version,
      semester: status.semester,
      releaseNote: `一键回滚数据至历史版本 ${version}`
    });

    writeAuditLog(req, "rollback", "sync-release", version, `一键回滚数据至版本 ${version}`);

    return res.json({
      success: true,
      message: `已成功回滚至版本 ${version}`,
      version,
      semester: status.semester,
    });
  } catch (error) {
    console.error("Rollback failed:", error);
    return res.status(500).json({ success: false, message: "回滚失败: " + error.message });
  }
});

router.delete("/sync/releases/:version", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const result = releaseService.deleteReleaseVersion(req.params.version);
    writeAuditLog(req, "delete", "sync-release", result.version, `删除历史 Release: ${result.version}`);
    return res.json({
      success: true,
      message: `历史 Release ${result.version} 已删除`,
      deleted: result,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/sync/releases/rebuild-index", adminAuth.verifyAdminAccess, async (req, res) => {
  console.log("👉 [admin.js] 收到重建索引请求, version =", req.body.version);
  try {
    const version = req.body.version;
    if (!version) {
      return res.status(400).json({ success: false, message: "缺少必要参数 version" });
    }
    
    // Clear index memory cache first
    releaseService.clearDerivedCache();
    
    const rebuilt = releaseService.rebuildReleasePack(version);
    const derived = rebuilt.derived;
    
    // Warm cache
    const kinds = ["class", "teacher", "classroom", "course"];
    let totalItems = 0;
    kinds.forEach((kind) => {
      const warmed = releaseService.readActiveIndex(kind, version);
      if (warmed && warmed.success) {
        totalItems += (warmed.items || []).length;
      }
    });
    const emptyRoomIndex = releaseService.readEmptyRoomIndex(version);
    if (emptyRoomIndex && emptyRoomIndex.success) {
      totalItems += (emptyRoomIndex.rooms || []).length;
    }
    
    writeAuditLog(req, "rebuild-index", "sync-release", version, `重建版本 ${version} 的轻量索引`);
    
    return res.json({
      success: true,
      message: `已成功重建版本 ${version} 的 Release Pack`,
      version: rebuilt.version,
      releaseVersion: rebuilt.releaseVersion,
      totalItems,
      derived,
      releasePack: rebuilt.status,
      manifest: rebuilt.manifest
    });
  } catch (error) {
    console.error("Rebuild index failed:", error);
    return res.status(500).json({ success: false, message: "重建索引失败: " + error.message });
  }
});

router.get("/sync/releases/check-availability", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const active = releaseService.getActiveReleaseInfo();
    const result = {
      activeReleaseVersion: active ? active.version : null,
      appConfig: { status: "unknown", message: "" },
      searchIndex: { status: "unknown", details: {} },
      scheduleDetail: { status: "unknown", details: {} },
      emptyRoom: { status: "unknown", details: {} },
      releasePack: { status: "unknown", details: {} }
    };
    
    // 1. Check App Config
    try {
      const publicConfig = appConfigService.getPublicAppConfig();
      if (publicConfig && publicConfig.success && publicConfig.data) {
        result.appConfig.status = "OK";
        result.appConfig.message = `学期: ${publicConfig.data.currentSemester}, 版本: ${publicConfig.data.dataVersion?.releaseVersion || '无'}`;
      } else {
        result.appConfig.status = "Fail";
        result.appConfig.message = "返回 success: false 或无数据";
      }
    } catch (e) {
      result.appConfig.status = "Fail";
      result.appConfig.message = e.message;
    }
    
    // If there is no active release, we cannot check index & details
    if (!active || !active.version) {
      result.searchIndex.status = "Fail";
      result.searchIndex.message = "无当前活跃 Release 版本";
      result.scheduleDetail.status = "Fail";
      result.scheduleDetail.message = "无当前活跃 Release 版本";
      result.releasePack.status = "Fail";
      result.releasePack.message = "无当前活跃 Release 版本";
      return res.json({ success: true, result });
    }

    const packStatus = releaseService.getReleasePackStatus(active.version);
    result.releasePack = {
      status: packStatus.healthy ? "OK" : "Fail",
      details: packStatus,
      message: packStatus.healthy ? "Release Pack 完整" : packStatus.missing.concat(packStatus.hashErrors).join("; "),
    };
    
    // 2. Check Search Index
    try {
      const kinds = ["class", "teacher", "classroom", "course"];
      let allOk = true;
      kinds.forEach((kind) => {
        const indexResult = releaseService.readActiveIndex(kind, active.version);
        if (indexResult && indexResult.success) {
          result.searchIndex.details[kind] = { status: "OK", count: (indexResult.items || []).length };
        } else {
          result.searchIndex.details[kind] = { status: "Fail", message: indexResult ? indexResult.reasonCode : "未知错误" };
          allOk = false;
        }
      });
      result.searchIndex.status = allOk ? "OK" : "Fail";
    } catch (e) {
      result.searchIndex.status = "Fail";
      result.searchIndex.message = e.message;
    }
    
    // 3. Check Schedule Details by reading a few items from index
    try {
      const kinds = ["class", "teacher", "classroom", "course"];
      let allOk = true;
      for (const kind of kinds) {
        const indexResult = releaseService.readActiveIndex(kind, active.version);
        if (indexResult && indexResult.success && indexResult.items && indexResult.items.length > 0) {
          // Take first item and read schedule detail
          const firstItem = indexResult.items[0];
          const firstId = firstItem.id || firstItem.detailId || firstItem.classId;
          if (firstId) {
            const detailResult = releaseService.readActiveSchedule(kind, firstId, active.version);
            if (detailResult && detailResult.success && detailResult.schedule) {
              result.scheduleDetail.details[kind] = { status: "OK", testId: firstId, testName: firstItem.name || "" };
            } else {
              result.scheduleDetail.details[kind] = { status: "Fail", testId: firstId, message: detailResult ? detailResult.reasonCode : "读取失败" };
              allOk = false;
            }
          } else {
            result.scheduleDetail.details[kind] = { status: "Fail", message: "索引项中没有有效的 ID" };
            allOk = false;
          }
        } else {
          result.scheduleDetail.details[kind] = { status: "Empty", message: "没有索引项可测试" };
          allOk = false;
        }
      }
      result.scheduleDetail.status = allOk ? "OK" : "Fail";
    } catch (e) {
      result.scheduleDetail.status = "Fail";
      result.scheduleDetail.message = e.message;
    }

    // 4. Check Empty Room Index
    try {
      const emptyRoomIndex = releaseService.readEmptyRoomIndex(active.version);
      if (emptyRoomIndex && emptyRoomIndex.success) {
        result.emptyRoom.status = "OK";
        result.emptyRoom.details = {
          count: (emptyRoomIndex.rooms || []).length,
          buildings: emptyRoomIndex.buildings || [],
        };
      } else {
        result.emptyRoom.status = "Fail";
        result.emptyRoom.message = emptyRoomIndex ? (emptyRoomIndex.reasonCode || emptyRoomIndex.code) : "读取失败";
      }
    } catch (e) {
      result.emptyRoom.status = "Fail";
      result.emptyRoom.message = e.message;
    }
    
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5.6 GET /api/admin/sync/command-guide
 * 前端拉取动态生成一键同步脚本运维指南
 */
router.get("/sync/command-guide", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const term = req.query.term || "2026-2027-1";
    const start = req.query.start || "2026-09-01";
    const note = req.query.note || `${term}新学期课表首版`;
    const projectRoot = "C:\\Users\\Katelya\\Documents\\VScode\\FosuClass";
    const includeAll = "classSchedules,teacherSchedules,classroomSchedules,courseSchedules,classrooms,teachers,courses";
    const commands = [
      {
        id: "local-campus",
        name: "项目内本机同步 (管理员使用，需要项目根目录)",
        command: [
          `cd ${projectRoot}`,
          `$env:SYNC_CLASS_SCOPE="all"`,
          `$env:SYNC_CLASS_GRADES="2025,2024,2023,2022,2021"`,
          `$env:SYNC_INCLUDE_SCOPES="${includeAll}"`,
          `npm run sync:local-campus -- --term=${term} --start=${start} --output=./staging/${term}-full.json --include=${includeAll} --class-scope=all --grades=2025,2024,2023,2022,2021`
        ].join("\n"),
        scene: "管理员自己电脑已连校园网，直接抓取全校课表并生成本地 Staging JSON",
        precondition: "需要项目根目录、完整源码、Node.js 环境及 npm install 依赖；且处于校园网/学校 VPN 环境。生成的 Staging JSON 文件将统一输出到项目根目录的 staging 目录下。",
        duration: "8 ~ 20 分钟",
        intranetRequired: true,
        risk: "中",
        failureReason: "未连校园网、学期填错、教务系统崩溃",
        solution: "重新登录教务系统，确认能访问 100.fosu.edu.cn 后重跑；只生成 Staging，不自动发布线上"
      },
      {
        id: "local-upload",
        name: "上传本地 Staging (管理员使用，需要项目根目录)",
        command: [
          `cd ${projectRoot}`,
          `npm run sync:local-upload -- --file=./staging/${term}-full.json --server=https://class.katelya.eu.org`
        ].join("\n"),
        scene: "管理员将本地已生成的 Staging JSON 上传到 VPS 暂存区。优先使用绝对路径或明确提示以防相对路径在子进程 cwd 变化时出现错误。",
        precondition: `已生成合法 Staging JSON，并持有管理员上传令牌 (ADMIN_API_TOKEN)。\n` +
          `【PowerShell 推荐写法】建议通过绝对路径以防路径重复拼接错误：\n` +
          `$file = (Resolve-Path ".\\staging\\${term}-full.json").Path\n` +
          `npm run sync:local-upload -- --file="$file" --server=https://class.katelya.eu.org\n\n` +
          `【兼容旧路径写法】若生成的文件位于 tools/fosu-sync-client/staging：\n` +
          `$file = (Resolve-Path ".\\tools\\fosu-sync-client\\staging\\${term}-full.json").Path\n` +
          `npm run sync:local-upload -- --file="$file" --server=https://class.katelya.eu.org`,
        duration: "15 ~ 60 秒",
        intranetRequired: false,
        risk: "低",
        failureReason: "JSON 校验不通过、ADMIN_API_TOKEN 无效、VPS 连通超时",
        solution: "运行 npm run test:course-normalizer 检查 JSON 数据合法性，或检查 .env 中的 ADMIN_API_TOKEN 配置"
      },
      {
        id: "relay-agent",
        name: "分发命令 (同学使用，使用 relay-agent 工具包)",
        command: `【接力端一键运行】解压 fosu-relay-agent-win-x64.zip，双击 start.bat 输入 token 即可`,
        scene: "将轻量级接力采集包分发给校园网内的同学，委托其采集数据并上传到 Staging 审核区",
        precondition: "已在后台创建接力任务（未吊销、未过期）；接力同学处于校园网环境，且本地有 Node 运行环境",
        duration: "8 ~ 20 分钟",
        intranetRequired: true,
        risk: "低",
        failureReason: "relay token 过期、上传次数用尽、同学未连校园网",
        solution: "在后台重新创建接力任务；接力上传后需要管理员在后台提升为 Staging 并发布"
      },
      {
        id: "release",
        name: "发布当前 Staging",
        command: "在后台 Staging 预览中点击「发布为正式版本」",
        scene: "VPS 将当前 Staging 校验通过的数据发布为正式 release，发布前会备份旧版本",
        precondition: "Staging 已上传、diff 已核对；大幅变动需要管理员强确认",
        duration: "15 ~ 30 秒",
        intranetRequired: false,
        risk: "中 (影响小程序线上展示)",
        failureReason: "Staging 数据校验失败、变动率超过熔断阈值、release 写入失败",
        solution: "查看 Staging diff 与校验警告，确认是新学期更替后再强制发布"
      },
      {
        id: "normalizer",
        name: "课程格式校验",
        command: [
          `cd ${projectRoot}`,
          "npm run test:course-normalizer"
        ].join("\n"),
        scene: "每次同步前后或发布快照前运行，确保体育课多地点、教师地名正常化提取准确",
        precondition: "无，本地随时运行测试",
        duration: "1 ~ 3 秒",
        intranetRequired: false,
        risk: "低",
        failureReason: "测试硬编码断言异常 (通常因为别名合并算法更新改变了提取特征)",
        solution: "检查 miniprogram/utils/courseNormalizer.js 中对体育课等合并机制的适配"
      },
      {
        id: "server-direct",
        name: "服务器直连兼容模式",
        command: `npm run sync:fresh -- --term=${term} --start=${start}`,
        scene: "仅保留给未来具备校园网出口的服务器环境；当前 VPS 不能访问 100.fosu.edu.cn 是预期情况",
        precondition: "服务器必须真实处于可访问学校内网的网络环境",
        duration: "8 ~ 20 分钟",
        intranetRequired: true,
        risk: "中高",
        failureReason: "公网 VPS 无法访问学校内网或校园 VPN，不是用户本机网络异常",
        solution: "切回本机校园网同步或接力代理端同步"
      }
    ];

    return res.json({
      success: true,
      commands
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 6. GET /api/admin/sync/history
 * 同步历史查询
 */
router.get("/sync/history", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const history = readJsonArray(SYNC_HISTORY_PATH);
    return res.json({
      success: true,
      items: history.slice(0, 100) // 最多取 100 条
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 7. POST /api/admin/sync/record
 * 记录一次同步结果
 */
router.post("/sync/record", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, semester, source, count, success, errorMsg } = req.body;
    const history = readJsonArray(SYNC_HISTORY_PATH);
    
    const record = {
      id: `sync_${Date.now()}`,
      time: new Date().toISOString(),
      type: type || "manual",
      semester: semester || "2025-2026-2",
      source: source || "web-admin",
      count: parseInt(count, 10) || 0,
      success: success !== false,
      errorMsg: errorMsg || "",
      operator: "admin"
    };
    
    history.unshift(record);
    writeJsonAtomic(SYNC_HISTORY_PATH, history.slice(0, 500)); // 保持 500 条
    writeAuditLog(req, "sync", "sync-history", type, `上报同步数据: ${type}, 导入: ${count} 条`);
    
    return res.json({ success: true, record });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 8. GET /api/admin/quality/report
 * 获取数据质量报告
 */
router.get("/quality/report", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const report = generateQualityReport();
    return res.json({
      success: true,
      data: report
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 9. POST /api/admin/quality/mark
 * 标记质量异常为已知/忽略
 */
router.post("/quality/mark", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, target, ignore } = req.body;
    if (!type || !target) {
      return res.status(400).json({ success: false, message: "缺少必要参数 type 或 target" });
    }
    
    let ignores = [];
    try {
      if (fs.existsSync(QUALITY_IGNORES_PATH)) {
        ignores = JSON.parse(fs.readFileSync(QUALITY_IGNORES_PATH, "utf-8"));
      }
    } catch (e) {}
    
    if (ignore) {
      if (!ignores.some(x => x.type === type && x.target === target)) {
        ignores.push({ type, target, markedAt: new Date().toISOString() });
      }
    } else {
      ignores = ignores.filter(x => !(x.type === type && x.target === target));
    }
    
    writeJsonAtomic(QUALITY_IGNORES_PATH, ignores);
    writeAuditLog(req, "ignore", "quality", `${type}:${target}`, `${ignore ? "标记忽略" : "取消忽略"} 质量缺陷`);
    
    return res.json({ success: true, ignores });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 10. GET /api/admin/export
 * 数据导出 API (支持导出 JSON / CSV)
 */
router.get("/export", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, id, format = "json" } = req.query;
    if (!type || !id) {
      return res.status(400).json({ success: false, message: "缺少 type 或 id" });
    }
    
  let original = null;
  if (type === "class") {
    original = getResourceArrayWithSource("class-schedules").items.find(x => x.className === id);
  } else if (type === "teacher") {
    original = getResourceArrayWithSource("teacher-schedules").items.find(x => x.teacherName === id);
  } else if (type === "classroom") {
    original = getResourceArrayWithSource("classroom-schedules").items.find(x => x.roomName === id);
  } else if (type === "course") {
    original = getResourceArrayWithSource("course-schedules").items.find(x => x.courseName === id);
  }
    
    if (!original) {
      return res.status(404).json({ success: false, message: "资源未找到" });
    }
    
    if (format === "csv") {
      const headers = ["courseName", "teacherName", "classroom", "weekday", "sections", "weeks", "note"];
      const rows = (original.courses || []).map(c => [
        `"${String(c.courseName || "").replace(/"/g, '""')}"`,
        `"${String(c.teacherName || "").replace(/"/g, '""')}"`,
        `"${String(c.classroom || "").replace(/"/g, '""')}"`,
        c.dayOfWeek || c.weekday || 1,
        `"${(c.sections || []).join("-")}"`,
        `"${(c.weeks || []).join(",")}"`,
        `"${String(c.note || "").replace(/"/g, '""')}"`
      ].join(","));
      
      const csv = `\uFEFF${headers.join(",")}\n${rows.join("\n")}\n`;
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(id)}.csv"`);
      res.type("text/csv");
      return res.send(csv);
    }
    
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(id)}.json"`);
    res.type("json");
    return res.json(original);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 11. GET /api/admin/backups
 * 备份文件管理 API
 */
router.get("/backups", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      return res.json({ success: true, items: [] });
    }
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, f));
        return {
          filename: f,
          size: `${Math.round(stat.size / 1024)} KB`,
          createdAt: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.json({ success: true, items: files });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get("/backups/download", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const file = req.query.filename;
    const safeFile = path.basename(file);
    const filePath = path.join(BACKUPS_DIR, safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "备份文件不存在" });
    }
    return res.download(filePath);
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.delete("/backups", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const file = req.query.filename;
    const safeFile = path.basename(file);
    const filePath = path.join(BACKUPS_DIR, safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "备份文件不存在" });
    }
    fs.unlinkSync(filePath);
    writeAuditLog(req, "delete", "backups", safeFile, `删除数据备份: ${safeFile}`);
    return res.json({ success: true, message: "删除备份成功" });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * 12. GET /api/admin/audit-logs
 * 审计日志 API
 */
router.get("/audit-logs", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) {
      return res.json({ success: true, items: [] });
    }
    const lines = fs.readFileSync(AUDIT_LOG_PATH, "utf-8")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        try { return JSON.parse(l); } catch(err) { return null; }
      })
      .filter(Boolean)
      .reverse();
    return res.json({ success: true, items: lines.slice(0, 100) });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router._test = {
  buildClassroomHeatmap,
  deriveClassroomSchedulesFromClassSchedules,
  normalizeCourseSlot,
  verifyAdminWriteAccess,
  summarizeStagingData,
  validateStagingData,
  buildStagingSafety,
};

module.exports = router;
