/**
 * 本地同步核心脚本：负责诊断网络、复用或注入登录状态、抓取教务数据并同步上传至 VPS 后端。
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const diagnose = require("./diagnose");
const envPath = path.resolve(__dirname, ".env");
require("dotenv").config({ path: envPath });

console.log(`[env] .env path: ${envPath}`);
console.log(`[env] FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);
console.log(`[env] PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "未配置"}`);
console.log(`[env] SYNC_GRADE_RANGE: ${process.env.SYNC_GRADE_RANGE || "未配置"}`);
console.log(`[env] SYNC_GRADES (专业同步使用): ${process.env.SYNC_GRADES || "未配置"}`);
console.log(`[env] SYNC_CLASS_GRADES (班级课表同步使用): ${process.env.SYNC_CLASS_GRADES || "未配置"}`);
console.log(`[env] SYNC_UPLOAD_CHUNK_SIZE: ${process.env.SYNC_UPLOAD_CHUNK_SIZE || "10"}`);
console.log(`[env] SYNC_SKIP_NO_SCHEDULE_CACHE: ${process.env.SYNC_SKIP_NO_SCHEDULE_CACHE || "true"}`);
console.log(`[env] SYNC_RECHECK_NO_SCHEDULE: ${process.env.SYNC_RECHECK_NO_SCHEDULE || "false"}`);
console.log(`[env] ADMIN_API_TOKEN: ${process.env.ADMIN_API_TOKEN ? "present" : "missing"}`);

const parser = require("../../server/src/utils/parser");
const normalizer = require("../../server/src/utils/scheduleNormalizer");
const courseIdentity = require("../../server/src/utils/courseNormalizer");
const releaseService = require("../../server/src/services/releaseService");

const proxyEnvNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const detectedProxyEnv = proxyEnvNames
  .map((name) => [name, process.env[name]])
  .filter(([, value]) => Boolean(value));
const INITIAL_DETECTED_PROXIES = [...detectedProxyEnv]; // 备份初始代理，以便在 preflight 中输出
const disableProxy = String(process.env.SYNC_DISABLE_PROXY || "true").toLowerCase() !== "false";
if (detectedProxyEnv.length > 0) {
  console.warn(`⚠️ 检测到代理环境变量: ${detectedProxyEnv.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  if (disableProxy) {
    console.warn("⚠️ 同步上传默认禁用环境代理，避免 127.0.0.1:10808 等本地代理污染 VPS 上传。");
  }
}
if (disableProxy) {
  proxyEnvNames.forEach((name) => {
    delete process.env[name];
  });
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";
  axios.defaults.proxy = false;
}

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const FOSU_API_BASE = process.env.FOSU_API_BASE || "https://class.katelya.eu.org";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";
const FOSU_SYNC_AUTH_MODE = process.env.FOSU_SYNC_AUTH_MODE || "playwright-manual";
const SESSION_PATH = path.join(__dirname, ".session", "session.json");

// 延迟辅助函数
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getEnvFlag(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return String(value).toLowerCase() === "true";
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(`⚠️ 读取 JSON 文件失败，将按空数组处理: ${filePath} (${error.message})`);
    return [];
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function getMajorIdentityKey(major, semester) {
  return [
    semester,
    major.collegeCode || "",
    major.grade || "",
    major.code || major.majorCode || "",
  ].join("::");
}

function getLegacyMajorProgressKey(major) {
  return `${major.grade}_${major.code || major.majorCode || ""}`;
}

function hasCompletedMajor(progress, major, semester) {
  const completed = progress && Array.isArray(progress.completed) ? progress.completed : [];
  return completed.includes(getMajorIdentityKey(major, semester)) || completed.includes(getLegacyMajorProgressKey(major));
}

function markCompletedMajor(progress, major, semester) {
  const key = getMajorIdentityKey(major, semester);
  if (!Array.isArray(progress.completed)) {
    progress.completed = [];
  }
  if (!progress.completed.includes(key)) {
    progress.completed.push(key);
  }
}

function upsertNoScheduleMajor(records, item) {
  const key = getMajorIdentityKey({
    collegeCode: item.collegeCode,
    grade: item.grade,
    code: item.majorCode,
  }, item.semester);
  const index = records.findIndex((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode,
  }, record.semester) === key);
  if (index >= 0) {
    records[index] = item;
  } else {
    records.push(item);
  }
  return records;
}

function removeNoScheduleMajor(records, major, semester) {
  const key = getMajorIdentityKey(major, semester);
  return records.filter((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode,
  }, record.semester) !== key);
}

function upsertClassNameCandidateRecord(records, item) {
  const key = getMajorIdentityKey({
    collegeCode: item.collegeCode,
    grade: item.grade,
    code: item.majorCode,
  }, item.semester);
  const index = records.findIndex((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode,
  }, record.semester) === key);
  if (index >= 0) {
    records[index] = item;
  } else {
    records.push(item);
  }
  return records;
}

async function waitBetweenClassSyncRequests(isFiltered) {
  const delayMin = isFiltered ? 800 : 1500;
  const delayMax = isFiltered ? 1500 : 3000;
  const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
  console.log(`      ⏳ 随机等待 ${delay}ms...`);
  await sleep(delay);
}

/**
 * 兼容 HTTP/HTTPS 的 Playwright 导航辅助函数
 */
async function gotoPage(page, relativePath, options = { waitUntil: "networkidle" }) {
  // 确保相对路径以 / 开头
  const cleanPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  const httpUrl = `${FOSU_BASE_URL.replace(/^https:/i, "http:")}${cleanPath}`;
  const httpsUrl = `${FOSU_BASE_URL}${cleanPath}`;
  
  try {
    await page.goto(httpUrl, options);
  } catch (err) {
    try {
      await page.goto(httpsUrl, options);
    } catch (httpsErr) {
      throw new Error(`导航到 ${cleanPath} 彻底失败 (HTTP: ${err.message}, HTTPS: ${httpsErr.message})`);
    }
  }
}

/**
 * 将 manual-cookie 字符串解析为 Playwright 的 Cookie 对象数组
 */
function parseCookieString(cookieStr, domain) {
  if (!cookieStr) return [];
  const domainHost = new URL(domain).hostname;
  return cookieStr
    .split(";")
    .map((pair) => {
      const parts = pair.split("=");
      if (parts.length >= 2) {
        return {
          name: parts[0].trim(),
          value: parts.slice(1).join("=").trim(),
          domain: domainHost,
          path: "/",
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * 向 VPS 发送 POST 请求（管理员 Token 认证）
 */
function getRetryDelay(attempt) {
  const base = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

async function uploadToVps(endpoint, data, options = {}) {
  if (!ADMIN_API_TOKEN) {
    console.error("❌ 本地未配置 ADMIN_API_TOKEN！无法向 VPS 写入数据。");
    throw new Error("Missing ADMIN_API_TOKEN");
  }

  const url = `${FOSU_API_BASE}${endpoint}`;
  console.log(`📤 正在上传数据到 VPS: ${url} ...`);

  const maxRetries = options.maxRetries === undefined ? 4 : options.maxRetries;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, data, {
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": ADMIN_API_TOKEN,
        },
        proxy: false,
        timeout: parseInt(process.env.SYNC_UPLOAD_TIMEOUT_MS || "120000", 10),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      console.log(`✅ VPS 响应: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      const retryable = shouldRetryError(error);
      console.error(`❌ 上传失败 (${attempt}/${maxRetries}): ${error.message}`);
      if (error.response) {
        console.error(`   VPS 错误状态码: ${error.response.status}`);
        console.error(`   VPS 错误详情: ${JSON.stringify(error.response.data)}`);
      }
      if (!retryable || attempt >= maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`   ⏳ 网络抖动可重试，${delay}ms 后继续...`);
      await sleep(delay);
    }
  }
}

async function fetchVpsSyncStatus() {
  const url = `${FOSU_API_BASE}/api/admin/sync/status`;
  console.log(`🔎 正在读取 VPS 同步状态: ${url} ...`);

  const response = await axios.get(url, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false, // 显式禁用代理
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  return response.data;
}

function generateSnapshotVersion() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}`;
}

function normalizeScheduleEntryCourses(entry, fallbackContext = {}) {
  const context = Object.assign({}, fallbackContext, {
    semester: entry.semester || fallbackContext.semester,
    className: entry.className || fallbackContext.className,
    sourceType: entry.sourceType || fallbackContext.sourceType || "class",
    audienceType: entry.audienceType || fallbackContext.audienceType || "student",
  });
  const courses = normalizer.normalizeCourseList(entry.courses || [], context);
  return Object.assign({}, entry, { courses });
}

function parsePositiveLimit(value) {
  const number = parseInt(value || "", 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isUsableResourceName(value) {
  const text = String(value || "").trim();
  return Boolean(text) &&
    !["待补充", "暂无", "无", "未知", "多个地点", "多个教师", "见通知", "多个教师/见通知"].includes(text);
}

function limitMapEntries(map, limit) {
  const entries = Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true }));
  return limit > 0 ? entries.slice(0, limit) : entries;
}

function pushGroupedCourse(map, key, course) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(course);
}

function buildSnapshotResources(classSchedules, options = {}) {
  const includeTeachers = options.includeTeachers !== undefined
    ? options.includeTeachers
    : getEnvFlag("SYNC_RESOURCES_TEACHERS", false);
  const includeClassrooms = options.includeClassrooms !== undefined
    ? options.includeClassrooms
    : getEnvFlag("SYNC_RESOURCES_CLASSROOMS", false);
  const includeCourses = options.includeCourses !== undefined
    ? options.includeCourses
    : getEnvFlag("SYNC_RESOURCES_COURSES", false);
  const limit = parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT);
  const teacherMap = new Map();
  const classroomMap = new Map();
  const courseMap = new Map();

  (classSchedules || []).forEach((schedule) => {
    (schedule.courses || []).forEach((course) => {
      const baseCourse = Object.assign({}, course, {
        semester: course.semester || schedule.semester,
        classId: course.classId || schedule.classId || "",
        className: course.className || schedule.className || "",
        collegeCode: course.collegeCode || schedule.collegeCode || "",
        collegeName: course.collegeName || schedule.collegeName || "",
        grade: course.grade || schedule.grade || "",
        majorCode: course.majorCode || schedule.majorCode || "",
        majorName: course.majorName || schedule.majorName || "",
      });
      const courseName = baseCourse.canonicalCourseName || baseCourse.displayCourseName || baseCourse.courseName;
      const teacherName = baseCourse.canonicalTeacherName || baseCourse.displayTeacherName || baseCourse.teacherName;
      const classroom = baseCourse.canonicalClassroom || baseCourse.displayClassroom || baseCourse.classroom;

      if (includeTeachers && isUsableResourceName(teacherName) && !baseCourse.isTeacherFieldActuallyCourseName && !courseIdentity.isCourseLike(teacherName)) {
        pushGroupedCourse(teacherMap, teacherName, baseCourse);
      }
      if (includeClassrooms && isUsableResourceName(classroom)) {
        pushGroupedCourse(classroomMap, classroom, baseCourse);
      }
      if (includeCourses && isUsableResourceName(courseName) && !courseIdentity.isVenueLike(courseName)) {
        pushGroupedCourse(courseMap, courseName, baseCourse);
      }
    });
  });

  const teacherEntries = limitMapEntries(teacherMap, limit);
  const classroomEntries = limitMapEntries(classroomMap, limit);
  const courseEntries = limitMapEntries(courseMap, limit);

  return {
    teachers: teacherEntries.map(([teacherName, courses]) => ({ teacherName, courseCount: courses.length })),
    classrooms: classroomEntries.map(([roomName, courses]) => ({ roomName, courseCount: courses.length })),
    courses: courseEntries.map(([courseName, courses]) => ({ courseName, courseCount: courses.length })),
    teacherSchedules: teacherEntries.map(([teacherName, courses]) => ({ teacherName, courses })),
    classroomSchedules: classroomEntries.map(([roomName, courses]) => ({ roomName, courses })),
    courseSchedules: courseEntries.map(([courseName, courses]) => ({ courseName, courses })),
  };
}

function emptySnapshotResources() {
  return {
    teachers: [],
    classrooms: [],
    courses: [],
    teacherSchedules: [],
    classroomSchedules: [],
    courseSchedules: [],
  };
}

function normalizeSnapshotResources(resources) {
  const source = Object.assign(emptySnapshotResources(), resources || {});
  return {
    teachers: source.teachers || [],
    classrooms: source.classrooms || [],
    courses: source.courses || [],
    teacherSchedules: (source.teacherSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "teacher",
      audienceType: "teacher",
    })),
    classroomSchedules: (source.classroomSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "classroom",
      audienceType: "classroom",
    })),
    courseSchedules: (source.courseSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "course",
      audienceType: "course",
    })),
  };
}

function collectSnapshotCourses(snapshot) {
  const result = [];
  (snapshot.classSchedules || []).forEach((schedule) => {
    (schedule.courses || []).forEach((course) => result.push({ scheduleType: "class", scheduleName: schedule.className, course }));
  });
  const resources = snapshot.resources || {};
  [
    ["teacher", resources.teacherSchedules || [], "teacherName"],
    ["classroom", resources.classroomSchedules || [], "roomName"],
    ["course", resources.courseSchedules || [], "courseName"],
  ].forEach(([scheduleType, schedules, nameKey]) => {
    schedules.forEach((schedule) => {
      (schedule.courses || []).forEach((course) => result.push({
        scheduleType,
        scheduleName: schedule[nameKey],
        course,
      }));
    });
  });
  return result;
}

function buildNormalizeReport(snapshot) {
  const entries = collectSnapshotCourses(snapshot);
  const reasons = {};
  const samples = [];
  let normalizedCourseCount = 0;
  let venueCourseNameCount = 0;
  let teacherFieldCourseNameCount = 0;
  let physicalEducationLikeCount = 0;

  entries.forEach((entry) => {
    const course = entry.course || {};
    const reason = course.normalizationReason || "normal";
    reasons[reason] = (reasons[reason] || 0) + 1;
    const changed =
      reason !== "normal" ||
      (course.rawCourseName && course.canonicalCourseName && course.rawCourseName !== course.canonicalCourseName) ||
      (course.rawClassroom && course.canonicalClassroom && course.rawClassroom !== course.canonicalClassroom) ||
      (course.rawTeacherName && course.canonicalTeacherName && course.rawTeacherName !== course.canonicalTeacherName);

    if (changed) {
      normalizedCourseCount++;
      if (samples.length < 30) {
        samples.push({
          scheduleType: entry.scheduleType,
          scheduleName: entry.scheduleName,
          rawCourseName: course.rawCourseName || course.courseName,
          rawTeacherName: course.rawTeacherName || course.teacherName,
          rawClassroom: course.rawClassroom || course.classroom,
          canonicalCourseName: course.canonicalCourseName,
          canonicalClassroom: course.canonicalClassroom,
          canonicalTeacherName: course.canonicalTeacherName,
          normalizationReason: reason,
        });
      }
    }
    if (course.isVenueCandidate) {
      venueCourseNameCount++;
    }
    if (course.isTeacherFieldActuallyCourseName) {
      teacherFieldCourseNameCount++;
    }
    if (course.isPhysicalEducationLike) {
      physicalEducationLikeCount++;
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    snapshotVersion: snapshot.version,
    semester: snapshot.semester,
    totalCourseCount: entries.length,
    normalizedCourseCount,
    venueCourseNameCount,
    teacherFieldCourseNameCount,
    physicalEducationLikeCount,
    reasons,
    samples,
  };
}

function writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer) {
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(path.join(debugDir, "snapshot-latest.json"), snapshotJson, "utf-8");
  fs.writeFileSync(path.join(debugDir, "snapshot-latest.json.gz"), compressedBuffer);
  const normalizeReport = buildNormalizeReport(snapshot);
  fs.writeFileSync(path.join(debugDir, "normalize-report-latest.json"), JSON.stringify(normalizeReport, null, 2), "utf-8");
  console.log(`💾 规范化报告已保存至 .debug/normalize-report-latest.json，修正课程 ${normalizeReport.normalizedCourseCount}/${normalizeReport.totalCourseCount} 条`);
  return normalizeReport;
}

function buildSnapshot(catalog, majors, allClassSchedules, resourceSchedules, options = {}) {
  const version = generateSnapshotVersion();
  const activeSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const noScheduleCachePath = path.join(__dirname, ".debug", "no-schedule-majors.json");
  const noScheduleMajors = readJsonArray(noScheduleCachePath);
  const md5 = (str) => crypto.createHash("md5").update(str).digest("hex");
  const updatedSchedules = (allClassSchedules || []).map((item) => {
    const classId = item.classId || md5(`${item.semester}_${item.collegeCode}_${item.grade}_${item.majorCode}_${item.className}`);
    const withClassId = Object.assign({}, item, { classId });
    return normalizeScheduleEntryCourses(withClassId, {
      semester: item.semester || activeSemester,
      classId,
      className: item.className,
      sourceType: "class",
      audienceType: "student",
    });
  });
  const resources = normalizeSnapshotResources(resourceSchedules || buildSnapshotResources(updatedSchedules, options.resources || {}));
  
  const collegeCount = (catalog.colleges || []).length;
  const majorCount = (majors || []).length;
  const classScheduleCount = updatedSchedules.length;
  const adminClassCount = updatedSchedules.filter(
    (item) => item.displayType === "class-schedule" && !item.isAggregated
  ).length;
  const majorAggregateCount = classScheduleCount - adminClassCount;
  const noScheduleMajorCount = noScheduleMajors.length;
  const teacherScheduleCount = resources.teacherSchedules.length;
  const classroomScheduleCount = resources.classroomSchedules.length;
  const courseScheduleCount = resources.courseSchedules.length;

  const timeTableSections = [
    { section: 1, start: "08:00", end: "08:40" },
    { section: 2, start: "08:45", end: "09:25" },
    { section: 3, start: "09:40", end: "10:20" },
    { section: 4, start: "10:25", end: "11:05" },
    { section: 5, start: "11:10", end: "11:50" },
    { section: 6, start: "13:30", end: "14:10" },
    { section: 7, start: "14:15", end: "14:55" },
    { section: 8, start: "15:10", end: "15:50" },
    { section: 9, start: "15:55", end: "16:35" },
    { section: 10, start: "16:40", end: "17:20" },
    { section: 11, start: "18:30", end: "19:10" },
    { section: 12, start: "19:15", end: "19:55" },
    { section: 13, start: "20:05", end: "20:45" },
    { section: 14, start: "20:50", end: "21:30" }
  ];

  return {
    version,
    semester: activeSemester,
    updatedAt: new Date().toISOString(),
    source: "local-sync-client",
    disclaimer: "课表数据仅供参考，具体以佛山大学教务系统、任课教师通知为准。",
    catalog: {
      semesters: catalog.semesters || [],
      colleges: catalog.colleges || [],
      grades: catalog.grades || [],
      weeks: catalog.weeks || [],
      sections: catalog.sections || []
    },
    majors: majors || [],
    classSchedules: updatedSchedules,
    resources,
    timeTable: {
      sections: timeTableSections
    },
    coverage: {
      collegeCount,
      majorCount,
      classScheduleCount,
      adminClassCount,
      majorAggregateCount,
      noScheduleMajorCount,
      teacherScheduleCount,
      classroomScheduleCount,
      courseScheduleCount
    }
  };
}

async function uploadSnapshot(buffer) {
  const url = `${FOSU_API_BASE}/api/admin/release/upload`;
  console.log(`📤 正在上传快照 (体积: ${(buffer.length / 1024 / 1024).toFixed(2)} MB) to: ${url}...`);
  const maxRetries = 4;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "x-admin-token": ADMIN_API_TOKEN
        },
        proxy: false,
        timeout: parseInt(process.env.SYNC_UPLOAD_TIMEOUT_MS || "120000", 10),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log(`✅ 快照上传 VPS 成功: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      console.error(`❌ 快照上传 VPS 失败 (${attempt}/${maxRetries}): ${error.message}`);
      if (error.response) {
        console.error(`   VPS 错误状态码: ${error.response.status}`);
        console.error(`   VPS 错误详情: ${JSON.stringify(error.response.data)}`);
      }
      if (!shouldRetryError(error) || attempt >= maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`   ⏳ 快照上传将在 ${delay}ms 后重试...`);
      await sleep(delay);
    }
  }
}

async function activateSnapshot(version) {
  const url = `${FOSU_API_BASE}/api/admin/release/activate`;
  console.log(`🔔 正在请求激活快照 (版本: ${version}) to: ${url}...`);
  try {
    const response = await axios.post(url, { version }, {
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": ADMIN_API_TOKEN
      },
      proxy: false, // 显式禁用代理
    });
    return response.data;
  } catch (error) {
    console.error(`❌ 快照激活失败: ${error.message}`);
    if (error.response) {
      console.error(`   VPS 错误状态码: ${error.response.status}`);
      console.error(`   VPS 错误详情: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

async function verifyEndpoints() {
  const bootstrapUrl = `${FOSU_API_BASE}/api/fosu/bootstrap`;
  const statusUrl = `${FOSU_API_BASE}/api/admin/sync/status`;
  const releaseStatusUrl = `${FOSU_API_BASE}/api/admin/release/status`;
  
  console.log(`🔎 正在验证 bootstrap 接口: ${bootstrapUrl}...`);
  const bRes = await axios.get(bootstrapUrl, { proxy: false });
  console.log(`   成功: ${bRes.data.success}, 数据源: ${bRes.data.dataSource}, 班级数: ${bRes.data.counts?.classScheduleCount}`);
  
  console.log(`🔎 正在验证管理员状态接口: ${statusUrl}...`);
  const sRes = await axios.get(statusUrl, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false
  });
  console.log(`   快照版本: ${sRes.data.snapshotVersion}, 快照更新时间: ${sRes.data.snapshotUpdatedAt}`);

  console.log(`🔎 正在验证 release 状态接口: ${releaseStatusUrl}...`);
  const rRes = await axios.get(releaseStatusUrl, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false
  });
  console.log(`   Active release: ${rRes.data.activeReleaseVersion}, updatedAt: ${rRes.data.activeReleaseUpdatedAt}`);
  
  return {
    bootstrap: bRes.data,
    status: sRes.data,
    releaseStatus: rRes.data
  };
}

function printReleaseSummary(snapshot, uploadResponse, activateResponse, verifyResponse) {
  const coverage = snapshot.coverage || {};
  const dryRun = Boolean(uploadResponse && uploadResponse.dryRun);
  console.log("\n================ [sync:release 发布摘要] ================");
  console.log(`- semester: ${snapshot.semester}`);
  console.log(`- collegesCount: ${coverage.collegeCount || coverage.collegesCount || 0}`);
  console.log(`- majorsCount: ${coverage.majorCount || coverage.majorsCount || 0}`);
  console.log(`- classScheduleCount: ${coverage.classScheduleCount || 0}`);
  console.log(`- teacherScheduleCount: ${coverage.teacherScheduleCount || 0}`);
  console.log(`- classroomScheduleCount: ${coverage.classroomScheduleCount || 0}`);
  console.log(`- courseScheduleCount: ${coverage.courseScheduleCount || 0}`);
  console.log(`- snapshotVersion: ${snapshot.version}`);
  console.log(`- updatedAt: ${snapshot.updatedAt}`);
  console.log(`- upload batches: ${dryRun ? 0 : (uploadResponse ? 1 : 0)}`);
  console.log(`- failed batches: 0`);
  console.log(`- activeReleaseVersion: ${dryRun ? "(dry-run, not activated)" : (activateResponse?.version || verifyResponse?.releaseStatus?.activeReleaseVersion || "")}`);
  console.log("=======================================================\n");
}

function validateLocalReleaseSnapshot(snapshot) {
  const validation = releaseService.validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    console.error("❌ 本地 release 校验失败：");
    validation.errors.slice(0, 20).forEach((error) => console.error(`   - ${error}`));
    if (validation.errors.length > 20) {
      console.error(`   ... 还有 ${validation.errors.length - 20} 个错误`);
    }
    throw new Error("Release validation failed");
  }
  console.log(`✅ 本地 release 校验通过：classScheduleCount=${validation.counts.classScheduleCount}`);
  return validation;
}

function getUploadChunkSize() {
  const parsed = parseInt(process.env.SYNC_UPLOAD_CHUNK_SIZE || "10", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  console.warn(`⚠️ SYNC_UPLOAD_CHUNK_SIZE=${process.env.SYNC_UPLOAD_CHUNK_SIZE} 无效，已回退为 10。`);
  return 10;
}

/**
 * 格式化当前时间为 YYYYMMDD-HHmmss 格式
 * @returns {string} 格式化后的时间戳
 */
function getFormattedTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const MM = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}${MM}${dd}-${hh}${mm}${ss}`;
}

/**
 * 判断 Axios 错误是否可以重试
 * @param {Error} error Axios 错误对象
 * @returns {boolean} 是否可以重试
 */
function shouldRetryError(error) {
  if (!error) return false;

  // 校验 HTTP 状态码
  if (error.response) {
    const status = error.response.status;
    // 502, 503, 504 属于可重试的服务器错误
    if ([502, 503, 504].includes(status)) {
      return true;
    }
    // 400, 401, 403 属于客户端错误，不重试
    if ([400, 401, 403].includes(status)) {
      return false;
    }
  }

  const errCode = error.code || "";
  const errMessage = error.message || "";

  // 常见网络和超时错误代码
  const retryCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"];
  if (retryCodes.includes(errCode)) {
    return true;
  }

  // 常见网络挂起及 SSL/TLS 握手错误信息
  const retryMessages = [
    "socket hang up",
    "timeout",
    "Client network socket disconnected before secure TLS connection was established",
    "disconnected before secure TLS connection"
  ];

  if (retryMessages.some((msg) => errMessage.includes(msg))) {
    return true;
  }

  return false;
}

/**
 * 带重试机制的单块上传函数
 * @param {string} endpoint 接口地址
 * @param {Array} chunk 课表数据分块
 * @param {number} chunkNumber 当前分块序号
 * @param {number} totalChunks 分块总数
 */
async function uploadWithRetry(endpoint, chunk, chunkNumber, totalChunks) {
  const maxRetries = 5;
  const retryDelays = [2000, 5000, 10000, 20000, 30000];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await uploadToVps(endpoint, chunk, { maxRetries: 1 });
      if (!Array.isArray(chunk) && Array.isArray(chunk && chunk.items)) {
        chunk.length = chunk.items.length;
      }
      console.log(`   ✅ [chunk ${chunkNumber}/${totalChunks}] 上传成功 (共 ${chunk.length} 条)`);
      return result;
    } catch (error) {
      const isRetryable = shouldRetryError(error);
      const attemptStr = `[chunk ${chunkNumber}/${totalChunks}] 第 ${attempt} 次尝试失败.`;

      if (attempt <= maxRetries && isRetryable) {
        const delay = retryDelays[attempt - 1] || 30000;
        console.warn(`   ⚠️ ${attemptStr} 错误可重试: ${error.message}。将在 ${delay / 1000}s 后进行第 ${attempt + 1} 次尝试...`);
        await sleep(delay);
      } else {
        console.error(`   ❌ ${attemptStr} 发生不可重试错误或重试次数超限。错误: ${error.message}`);
        throw error;
      }
    }
  }
}

/**
 * 读取断点续传进度
 * @param {string} sourceFilePath 数据源文件路径
 * @returns {Object} 进度对象
 */
function readUploadProgress(sourceFilePath) {
  const progressPath = path.join(__dirname, ".debug", "class-upload-progress.json");
  const forceRestart = getEnvFlag("SYNC_UPLOAD_FORCE_RESTART", false);

  if (forceRestart) {
    console.log("ℹ️ SYNC_UPLOAD_FORCE_RESTART=true，忽略已存在的上传进度，将从头开始重新上传。");
    return { uploadedChunkIndexes: [] };
  }

  if (fs.existsSync(progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      // 只有源文件路径一致时进度才有效
      if (progress.sourceFile === sourceFilePath) {
        console.log(`ℹ️ 恢复上次上传进度，已成功上传批次: ${progress.uploadedChunkIndexes.join(", ")}`);
        return progress;
      } else {
        console.log(`ℹ️ 进度文件中的源文件不匹配 (${progress.sourceFile} vs ${sourceFilePath})，重新开始。`);
      }
    } catch (e) {
      console.warn("⚠️ 读取上传进度文件失败，将重新上传。");
    }
  }
  return { uploadedChunkIndexes: [] };
}

/**
 * 写入断点续传进度
 * @param {string} sourceFilePath 数据源文件路径
 * @param {string} semester 当前学期
 * @param {number} total 数据总条数
 * @param {number} chunkSize 分块大小
 * @param {Array<number>} uploadedChunkIndexes 已成功的分块序号列表
 */
function writeUploadProgress(sourceFilePath, semester, total, chunkSize, uploadedChunkIndexes) {
  const progressPath = path.join(__dirname, ".debug", "class-upload-progress.json");
  const progress = {
    sourceFile: sourceFilePath,
    semester,
    total,
    chunkSize,
    uploadedChunkIndexes,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * 将完整的班级课表数据存盘
 * @param {Array} allClassSchedules 整理好的班级课表
 * @param {string} semester 学期
 * @returns {Object} 包含所保存的文件路径
 */
function saveFullClassSchedules(allClassSchedules, semester) {
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const payload = {
    success: true,
    type: "class-schedules",
    semester: semester,
    generatedAt: new Date().toISOString(),
    itemCount: allClassSchedules.length,
    items: allClassSchedules
  };

  const latestPath = path.join(debugDir, "class-schedules-latest.json");
  const timestampPath = path.join(debugDir, `class-schedules-${getFormattedTimestamp()}.json`);

  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf-8");
  fs.writeFileSync(timestampPath, JSON.stringify(payload, null, 2), "utf-8");

  console.log(`💾 完整课表数据已保存至:\n  - ${latestPath}\n  - ${timestampPath}`);
  return { latestPath, timestampPath };
}

/**
 * 分块上传班级课表
 * @param {Array} classSchedules 课表数组
 * @param {string} debugDir 调试目录
 * @param {string} sourceFilePath 数据源路径，用于断点进度校验
 * @param {string} semester 关联学期
 * @returns {Object} VPS 同步状态
 */
async function uploadClassSchedulesInChunks(classSchedules, debugDir, sourceFilePath, semester) {
  const chunkSize = getUploadChunkSize();
  const totalChunks = Math.ceil(classSchedules.length / chunkSize);

  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  // 获取并恢复上次上传的断点进度
  const progress = readUploadProgress(sourceFilePath);
  const uploadedChunkIndexes = progress.uploadedChunkIndexes || [];

  console.log(`📦 开始分块上传班级课表: ${classSchedules.length} 条，每批 ${chunkSize} 条，共 ${totalChunks} 批。`);

  for (let index = 0; index < totalChunks; index++) {
    const chunkNumber = index + 1;
    if (uploadedChunkIndexes.includes(chunkNumber)) {
      console.log(`⏭️ [chunk ${chunkNumber}/${totalChunks}] 该分块已上传过，自动跳过。`);
      continue;
    }

    const start = index * chunkSize;
    const chunk = classSchedules.slice(start, start + chunkSize);

    try {
      await uploadWithRetry("/api/admin/sync/class-schedules?mode=merge", chunk, chunkNumber, totalChunks);

      // 更新并记录当前上传成功的进度
      uploadedChunkIndexes.push(chunkNumber);
      writeUploadProgress(sourceFilePath, semester, classSchedules.length, chunkSize, uploadedChunkIndexes);
    } catch (error) {
      // 写入失败的分块文件以供后续诊断
      const failedPath = path.join(debugDir, `failed-class-schedules-chunk-${chunkNumber}.json`);
      fs.writeFileSync(failedPath, JSON.stringify(chunk, null, 2), "utf-8");
      console.error(`❌ [chunk ${chunkNumber}/${totalChunks}] 历经多次重试上传失败，失败批次已保存: ${failedPath}`);
      console.error(`⚠️ 完整课表数据已保存至 .debug/class-schedules-latest.json，可稍后执行 upload-only 继续上传。`);
      throw error;
    }
  }

  // 上传全部成功，删除进度文件
  try {
    const progressPath = path.join(debugDir, "class-upload-progress.json");
    if (fs.existsSync(progressPath)) {
      fs.unlinkSync(progressPath);
      console.log("🎉 所有分块已上传成功，已清除断点续传进度。");
    }
  } catch (e) {}

  const status = await fetchVpsSyncStatus();
  console.log("\n🔍 === [VPS 同步状态验证] ===");
  console.log(`- classScheduleCount: ${status.classScheduleCount ?? "未获取"}`);
  console.log(`- classSchedulesUpdatedAt: ${status.classSchedulesUpdatedAt ?? "未获取"}`);
  console.log(`- storageMounted: ${status.storageMounted ?? "未获取"}`);
  console.log(`- storagePath: ${status.storagePath ?? "未获取"}`);
  console.log("==============================\n");

  return status;
}

/**
 * 从本地文件中尝试读取课表缓存
 * @returns {Object} 包含 items (数组) 和 filePath (绝对路径)
 */
function readClassSchedulesFromFile() {
  const debugDir = path.join(__dirname, ".debug");
  const candidates = [];

  // 1. 优先读取环境变量指定的路径
  if (process.env.SYNC_CLASS_UPLOAD_FILE) {
    candidates.push(path.resolve(process.env.SYNC_CLASS_UPLOAD_FILE));
  }

  // 2. 依次读取可能存在的文件
  candidates.push(path.join(debugDir, "class-schedules-latest.json"));
  candidates.push(path.join(debugDir, "last-class-schedules.json"));
  candidates.push(path.join(debugDir, "last-class-schedules-upload.json"));

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        console.log(`📖 正在从本地文件读取课表数据: ${filePath}`);
        const content = fs.readFileSync(filePath, "utf-8");
        const json = JSON.parse(content);

        let items = null;
        if (Array.isArray(json)) {
          items = json;
        } else if (json && Array.isArray(json.items)) {
          items = json.items;
        } else if (json && Array.isArray(json.data)) {
          items = json.data;
        } else if (json && Array.isArray(json.classSchedules)) {
          items = json.classSchedules;
        }

        if (items && items.length > 0) {
          console.log(`✅ 成功提取出 ${items.length} 条课表数据。`);
          return { items, filePath };
        }
      } catch (err) {
        console.warn(`⚠️ 读取文件失败，尝试下一个路径: ${filePath} (${err.message})`);
      }
    }
  }

  // 都没读到则抛出详细错误
  const errorMessage = [
    "❌ 未找到任何有效的完整课表缓存文件！",
    "已检查的路径列表如下："
  ];
  candidates.forEach((c) => errorMessage.push(`  - ${c}`));

  // 检查是否仅存在分块失败的文件
  if (fs.existsSync(debugDir)) {
    const files = fs.readdirSync(debugDir);
    const failedChunks = files.filter((f) => f.startsWith("failed-class-schedules-chunk-"));
    if (failedChunks.length > 0) {
      errorMessage.push(`当前目录下仅发现分块失败文件: ${failedChunks.join(", ")}，这些文件不是完整数据。`);
    }
  }

  throw new Error(errorMessage.join("\n"));
}

/**
 * 打印 PowerShell 的执行命令建议
 */
function printPowerShellCommands() {
  console.log("\n💡 Windows PowerShell 常用命令指南：");
  console.log("--------------------------------------------------");
  console.log("👉 只抓取不上传 (Crawl Only):");
  console.log('   $env:SYNC_CLASS_SCOPE="all"');
  console.log('   $env:SYNC_CLASS_GRADES="2025,2024,2023,2022"');
  console.log('   $env:SYNC_CLASS_MAX_CONCURRENCY="1"');
  console.log('   $env:SYNC_CLASS_REQUEST_DELAY_MS="900"');
  console.log('   $env:SYNC_CLASS_CRAWL_ONLY="true"');
  console.log("   npm run sync:class");
  console.log("");
  console.log("👉 只上传本地缓存 (Upload Only):");
  console.log('   $env:SYNC_CLASS_CRAWL_ONLY=""');
  console.log('   $env:SYNC_CLASS_UPLOAD_ONLY="true"');
  console.log('   $env:SYNC_UPLOAD_CHUNK_SIZE="10"');
  console.log("   npm run sync:upload-cache");
  console.log("");
  console.log("👉 强制重新上传本地缓存 (Force Restart Upload):");
  console.log('   $env:SYNC_UPLOAD_FORCE_RESTART="true"');
  console.log('   $env:SYNC_CLASS_UPLOAD_ONLY="true"');
  console.log('   $env:SYNC_UPLOAD_CHUNK_SIZE="10"');
  console.log("   npm run sync:class");
  console.log("--------------------------------------------------\n");
}

/**
 * 处理仅上传逻辑 (UPLOAD_ONLY 模式入口)
 */
async function handleUploadOnly() {
  const debugDir = path.join(__dirname, ".debug");
  try {
    const { items, filePath } = readClassSchedulesFromFile();
    const semester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
    console.log(`🚀 开始在 upload-only 模式下上传数据，数据源：${filePath}，共计 ${items.length} 条。`);

    await uploadClassSchedulesInChunks(items, debugDir, filePath, semester);
    console.log(`✅ 本地缓存数据上传同步成功！`);
  } catch (error) {
    console.error(`❌ 执行 upload-only 模式失败: \n${error.message}`);
    printPowerShellCommands();
    process.exit(1);
  }
}

/**
 * 处理离线发布逻辑 (OFFLINE RELEASE 模式入口)
 */
async function handleOfflineRelease() {
  const zlib = require("zlib");
  console.log("🚀 开始在 offline-release 模式下发布快照...");
  
  const catalogPath = path.join(__dirname, "last-catalog.json");
  const majorsPath = path.join(__dirname, "last-majors.json");
  const schedPath = path.join(__dirname, ".debug", "class-schedules-latest.json");
  
  if (!fs.existsSync(catalogPath) || !fs.existsSync(majorsPath) || !fs.existsSync(schedPath)) {
    throw new Error("离线模式下，必须存在 last-catalog.json, last-majors.json 和 .debug/class-schedules-latest.json 缓存文件！");
  }
  
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const majors = JSON.parse(fs.readFileSync(majorsPath, "utf-8"));
  const schedJson = JSON.parse(fs.readFileSync(schedPath, "utf-8"));
  const allClassSchedules = Array.isArray(schedJson) ? schedJson : (schedJson.items || []);
  
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("本地课表缓存文件中的班级课表数量为 0");
  }

  console.log(`📖 成功从本地加载基础配置与课表缓存 (共计 ${allClassSchedules.length} 条课表)`);

  const includeReleaseResources = getEnvFlag("SYNC_RELEASE_INCLUDE_RESOURCES", true);
  const snapshot = buildSnapshot(catalog, majors, allClassSchedules, null, {
    resources: {
      includeTeachers: includeReleaseResources,
      includeClassrooms: includeReleaseResources,
      includeCourses: includeReleaseResources,
    },
  });
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  const snapshotBuffer = Buffer.from(snapshotJson, "utf-8");
  const compressedBuffer = zlib.gzipSync(snapshotBuffer);

  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const normalizeReport = writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer);
  console.log(`\n💾 本地快照已生成并压缩：.debug/snapshot-latest.json 和 .debug/snapshot-latest.json.gz (体积: ${(compressedBuffer.length / 1024).toFixed(2)} KB)`);
  validateLocalReleaseSnapshot(snapshot);

  if (getEnvFlag("SYNC_RELEASE_DRY_RUN", false)) {
    printReleaseSummary(snapshot, { dryRun: true }, { version: snapshot.version }, null);
    fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify({
      success: true,
      dryRun: true,
      version: snapshot.version,
      semester: snapshot.semester,
      updatedAt: snapshot.updatedAt,
      coverage: snapshot.coverage,
      normalizeReport,
      uploadSize: compressedBuffer.length,
    }, null, 2), "utf-8");
    console.log("ℹ️ SYNC_RELEASE_DRY_RUN=true，已完成本地 release 构建与校验，未上传或激活 VPS。");
    return;
  }

  const uploadRes = await uploadSnapshot(compressedBuffer);
  const activateRes = await activateSnapshot(snapshot.version);
  console.log(`✅ 快照激活成功! 响应: ${JSON.stringify(activateRes)}`);
  
  const verifyRes = await verifyEndpoints();
  printReleaseSummary(snapshot, uploadRes, activateRes, verifyRes);
  const report = {
    success: true,
    version: snapshot.version,
    semester: snapshot.semester,
    updatedAt: snapshot.updatedAt,
    coverage: snapshot.coverage,
    normalizeReport,
    uploadSize: compressedBuffer.length,
    serverStatus: verifyRes,
  };
  fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(`💾 总结报告已保存至 .debug/sync-report-latest.json`);
  console.log("\n🎉 [Release] 离线暴力快照发布完成！");
}

const RESOURCE_SYNC_CONFIGS = {
  teacher: {
    flag: "SYNC_RESOURCES_TEACHERS",
    schedulesKey: "teacherSchedules",
    indexKey: "teachers",
    endpointType: "teacher",
    label: "教师",
  },
  classroom: {
    flag: "SYNC_RESOURCES_CLASSROOMS",
    schedulesKey: "classroomSchedules",
    indexKey: "classrooms",
    endpointType: "classroom",
    label: "教室",
  },
  course: {
    flag: "SYNC_RESOURCES_COURSES",
    schedulesKey: "courseSchedules",
    indexKey: "courses",
    endpointType: "course",
    label: "课程",
  },
};

function normalizeResourceTypeList(types) {
  const list = Array.isArray(types) && types.length ? types : ["teacher", "classroom", "course"];
  return list.filter((type) => RESOURCE_SYNC_CONFIGS[type]);
}

function getResourceDelayConfig() {
  const requestDelay = parseInt(process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "", 10);
  const min = parseInt(process.env.SYNC_RESOURCE_DELAY_MIN_MS || process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "800", 10);
  const max = parseInt(process.env.SYNC_RESOURCE_DELAY_MAX_MS || process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "1500", 10);
  return {
    concurrency: parseInt(process.env.SYNC_RESOURCE_MAX_CONCURRENCY || process.env.SYNC_RESOURCE_CONCURRENCY || "1", 10) || 1,
    requestDelayMs: Number.isFinite(requestDelay) && requestDelay >= 0 ? requestDelay : null,
    minDelayMs: Number.isFinite(min) ? min : 800,
    maxDelayMs: Number.isFinite(max) ? max : 1500,
  };
}

function getResourceUploadChunkSize() {
  const value = parseInt(process.env.SYNC_RESOURCE_UPLOAD_CHUNK_SIZE || process.env.SYNC_UPLOAD_CHUNK_SIZE || "20", 10);
  return Number.isFinite(value) && value > 0 ? value : 20;
}

function buildResourceUploadId(type) {
  return `${type}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function uploadResourceSchedules(resources, resourceTypes, semester) {
  const results = {};
  const chunkSize = getResourceUploadChunkSize();
  const delayConfig = getResourceDelayConfig();
  const requestDelayMs = delayConfig.requestDelayMs !== null
    ? delayConfig.requestDelayMs
    : Math.max(0, delayConfig.minDelayMs);
  for (const type of normalizeResourceTypeList(resourceTypes)) {
    const config = RESOURCE_SYNC_CONFIGS[type];
    const items = resources[config.schedulesKey] || [];
    const totalChunks = Math.max(1, Math.ceil(items.length / chunkSize));
    const uploadId = buildResourceUploadId(type);
    console.log(`[resources] uploading ${type}: ${items.length} items, ${chunkSize} per chunk, ${totalChunks} chunks`);

    let finalResult = null;
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkNumber = index + 1;
      const chunk = items.slice(index * chunkSize, (index + 1) * chunkSize);
      const payload = {
        resourceType: type,
        semester,
        uploadId,
        chunkIndex: chunkNumber,
        totalChunks,
        chunkItemCount: chunk.length,
        items: chunk,
        generatedAt: new Date().toISOString(),
      };
      finalResult = await uploadWithRetry(`/api/admin/sync/resources?type=${config.endpointType}`, payload, chunkNumber, totalChunks);
      if (chunkNumber < totalChunks && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }
    }

    results[type] = Object.assign({
      resourceType: type,
      uploadId,
      chunkSize,
      totalChunks,
    }, finalResult || {});
  }
  return results;
}

async function handleResourcesSync(resourceTypes) {
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const manifestPath = path.join(debugDir, "class-schedules-manifest.json");
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();

  // 1. 读取并校验清单文件是否存在
  if (!fs.existsSync(manifestPath)) {
    console.error("❌ 没有找到班级课表抓取清单，sync:resources 只能基于本地班级课表缓存派生资源。请先运行 npm run sync:class 或 npm run sync:fresh。");
    throw new Error("Missing class-schedules-manifest.json");
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    console.error(`❌ 读取或解析班级课表抓取清单失败: ${err.message}`);
    throw err;
  }

  // 2. 校验 semester 是否与当前配置一致
  if (manifest.semester !== preferredSemester) {
    const allowStale = getEnvFlag("SYNC_RESOURCES_ALLOW_STALE", false);
    if (!allowStale) {
      console.error(`❌ 班级课表抓取清单的学期 [${manifest.semester}] 与当前配置的 Preferred Semester [${preferredSemester}] 不一致！`);
      console.error("💡 提示: 已阻止执行以防止派生错误数据。如果您确实需要，请设置环境变量: $env:SYNC_RESOURCES_ALLOW_STALE=\"true\"。");
      throw new Error("Semester mismatch in manifest");
    } else {
      console.warn(`⚠️ 警告: 班级课表学期 [${manifest.semester}] 与配置的 [${preferredSemester}] 不一致，但已设置 SYNC_RESOURCES_ALLOW_STALE=true，将继续执行。`);
    }
  }

  // 3. 校验 crawledAt 是否过期
  const crawledTime = new Date(manifest.crawledAt).getTime();
  const nowTime = Date.now();
  const diffHours = (nowTime - crawledTime) / (1000 * 60 * 60);

  if (diffHours > 24) {
    console.warn(`⚠️ 强警告: 本地班级课表缓存生成时间 [${manifest.crawledAt}] 距今已超过 ${diffHours.toFixed(1)} 小时，本地班级课表缓存可能不是最新数据。`);
  }

  const requireFresh = getEnvFlag("SYNC_RESOURCES_REQUIRE_FRESH", false);
  if (requireFresh && diffHours > 6) {
    console.error(`❌ 本地班级课表缓存已过期！生成时间距今已超过 6 小时 (${diffHours.toFixed(1)} 小时)，且设置了 SYNC_RESOURCES_REQUIRE_FRESH=true。`);
    throw new Error("Class schedules cache is stale (exceeded 6 hours)");
  }

  const { items, filePath } = readClassSchedulesFromFile();

  let fileMtime = "未知";
  try {
    const stat = fs.statSync(filePath);
    fileMtime = stat.mtime.toISOString();
  } catch (e) {}

  console.log("\n=================== [sync:resources 开始派生资源] ===================");
  console.log(`- 当前读取的 class-schedules-latest.json 路径: ${filePath}`);
  console.log(`- 该文件实际修改时间 (mtime): ${fileMtime}`);
  console.log(`- 抓取清单学期 (manifest semester): ${manifest.semester}`);
  console.log(`- 抓取清单生成时间 (manifest crawledAt): ${manifest.crawledAt}`);
  console.log(`- 抓取清单班级课表数量 (classScheduleCount): ${manifest.classScheduleCount || items.length}`);
  console.log("- 说明：此命令不会访问教务 100 网，只会基于刚才抓取的班级课表缓存派生教师/教室/课程维度。");
  console.log("===================================================================\n");
  const types = normalizeResourceTypeList(resourceTypes);
  const includeOptions = {
    includeTeachers: types.includes("teacher"),
    includeClassrooms: types.includes("classroom"),
    includeCourses: types.includes("course"),
  };
  const semester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const normalizedClassSchedules = items.map((item) => normalizeScheduleEntryCourses(item, {
    semester: item.semester || semester,
    sourceType: "class",
    audienceType: "student",
  }));
  const resources = buildSnapshotResources(normalizedClassSchedules, includeOptions);
  const resourcesPath = path.join(debugDir, "resources-latest.json");
  fs.writeFileSync(resourcesPath, JSON.stringify(resources, null, 2), "utf-8");

  const uploadResults = await uploadResourceSchedules(resources, types, semester);
  types.forEach((type) => {
    const config = RESOURCE_SYNC_CONFIGS[type];
    fs.writeFileSync(
      path.join(debugDir, `${type}-schedules-latest.json`),
      JSON.stringify({
        resourceType: type,
        semester,
        items: resources[config.schedulesKey] || [],
      }, null, 2),
      "utf-8"
    );
  });

  const report = {
    success: true,
    generatedAt: new Date().toISOString(),
    sourceFile: filePath,
    resourceTypes: types,
    resourceRequestPolicy: getResourceDelayConfig(),
    flags: {
      SYNC_RESOURCES_TEACHERS: includeOptions.includeTeachers,
      SYNC_RESOURCES_CLASSROOMS: includeOptions.includeClassrooms,
      SYNC_RESOURCES_COURSES: includeOptions.includeCourses,
      SYNC_RESOURCE_LIMIT: parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT),
    },
    counts: {
      teachers: resources.teachers.length,
      classrooms: resources.classrooms.length,
      courses: resources.courses.length,
      teacherSchedules: resources.teacherSchedules.length,
      classroomSchedules: resources.classroomSchedules.length,
      courseSchedules: resources.courseSchedules.length,
    },
    uploadResults,
  };
  fs.writeFileSync(path.join(debugDir, "resources-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(`💾 资源维度数据已生成: ${resourcesPath}`);
  console.log(`📊 resources counts: ${JSON.stringify(report.counts)}`);

  // 生成并写入 resources-manifest.json
  let resourcesChecksum = "";
  try {
    const fileContent = fs.readFileSync(resourcesPath, "utf-8");
    resourcesChecksum = crypto.createHash("md5").update(fileContent).digest("hex");
  } catch (e) {}

  const resourcesManifest = {
    semester,
    generatedAt: report.generatedAt,
    source: path.basename(filePath),
    teacherScheduleCount: resources.teacherSchedules.length,
    classroomScheduleCount: resources.classroomSchedules.length,
    courseScheduleCount: resources.courseSchedules.length,
    checksum: resourcesChecksum
  };
  const resourcesManifestPath = path.join(debugDir, "resources-manifest.json");
  fs.writeFileSync(resourcesManifestPath, JSON.stringify(resourcesManifest, null, 2), "utf-8");
  console.log(`💾 资源维度清单已保存至: ${resourcesManifestPath}`);

  return resources;
}

/**
 * 初始化已登录的 Playwright 上下文
 */
async function initBrowserContext() {
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security",
    "--allow-running-insecure-content",
    "--no-proxy-server"
  ];

  let browser;
  // 优先尝试系统边缘浏览器，其次是 Chrome，最后回退内置 Chromium
  const channels = ["msedge", "chrome", null];
  for (const channel of channels) {
    try {
      const config = {
        headless: false, // 设为 false 以确保与系统通道的最大兼容性，并且能够直观展示同步过程
        args: launchArgs,
      };
      if (channel) {
        config.channel = channel;
        console.log(`尝试使用系统浏览器通道: ${channel} ...`);
      } else {
        console.log("使用内置 Chromium 浏览器 ...");
      }
      browser = await chromium.launch(config);
      break; // 成功启动则退出循环
    } catch (e) {
      console.warn(`⚠️ 浏览器通道 ${channel || "内置"} 启动失败: ${e.message}`);
      if (channel === null) {
        console.error("\n💡 提示: 如果您想使用内置 Chromium 浏览器，请先运行以下命令安装：");
        console.error("   npx playwright install chromium");
      }
    }
  }

  if (!browser) {
    console.error("❌ 无法启动任何浏览器！请检查 Playwright 安装是否完整。");
    process.exit(1);
  }

  let context;

  if (FOSU_SYNC_AUTH_MODE === "playwright-manual") {
    if (!fs.existsSync(SESSION_PATH)) {
      console.error("❌ 本地未找到 session.json 登录会话文件！");
      console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
      await browser.close();
      process.exit(1);
    }
    context = await browser.newContext({
      storageState: SESSION_PATH,
      ignoreHTTPSErrors: true,
    });
  } else if (FOSU_SYNC_AUTH_MODE === "manual-cookie") {
    if (!process.env.FOSU_MANUAL_COOKIE) {
      console.error("❌ 选择了 manual-cookie 模式，但未在 .env 中配置 FOSU_MANUAL_COOKIE！");
      await browser.close();
      process.exit(1);
    }
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    // 注入 cookie
    const cookies = parseCookieString(process.env.FOSU_MANUAL_COOKIE, FOSU_BASE_URL);
    await context.addCookies(cookies);
    console.log(`🔑 已从 .env 中注入 ${cookies.length} 个 Cookie 至浏览器会话。`);
  } else {
    console.error(`❌ 未知的登录模式: ${FOSU_SYNC_AUTH_MODE}`);
    await browser.close();
    process.exit(1);
  }

  return { browser, context };
}

/**
 * 校验登录态是否仍然有效
 */
async function checkSession(page) {
  console.log("🔒 正在校验会话有效性...");
  try {
    await gotoPage(page, "/framework/xsMain.jsp", { waitUntil: "networkidle" });
  } catch (error) {
    console.error(`❌ 导航至教务页失败，可能未连内网或握手彻底失败: ${error.message}`);
    console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
    return false;
  }
  
  const currentUrl = page.url();
  if (currentUrl.includes("authserver.fosu.edu.cn") || currentUrl.includes("login")) {
    console.error("❌ 会话已过期或无效！被重定向到了登录页面。");
    console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
    return false;
  }
  
  const content = await page.content();
  if (content.includes("统一身份认证") || content.includes("密码登录")) {
    console.error("❌ 会话已过期！页面包含登录标识。");
    console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
    return false;
  }
  
  console.log("🎉 会话有效，教务系统主页加载正常。");
  return true;
}

/**
 * 自动推断合理的当前学期
 */
function inferPreferredSemester() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 1 && month <= 8) {
    return `${year - 1}-${year}-2`;
  } else {
    return `${year}-${year}-1`;
  }
}

/**
 * 强制在页面选择指定学期并等待联动
 */
async function selectSemester(page, preferredSemester) {
  if (!preferredSemester) {
    return null;
  }
  
  console.log(`配置学期：${preferredSemester}`);

  // 在页面中寻找匹配的 select 和 option
  const selectResult = await page.evaluate((prefSem) => {
    const selects = Array.from(document.querySelectorAll("select"));
    for (let sIdx = 0; sIdx < selects.length; sIdx++) {
      const sel = selects[sIdx];
      const name = sel.getAttribute("name") || "";
      const id = sel.getAttribute("id") || "";
      
      for (let oIdx = 0; oIdx < sel.options.length; oIdx++) {
        const opt = sel.options[oIdx];
        const val = opt.value || "";
        const txt = opt.textContent || "";
        
        if (val.includes(prefSem) || txt.includes(prefSem)) {
          return {
            selectIndex: sIdx,
            selectName: name,
            selectId: id,
            optionValue: val,
            optionText: txt.trim()
          };
        }
      }
    }
    return null;
  }, preferredSemester);

  if (!selectResult) {
    // 打印教务系统的可选学期，以供调试
    const allSemOptions = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const debugInfo = [];
      selects.forEach((sel) => {
        const name = sel.getAttribute("name") || sel.getAttribute("id") || "unnamed";
        if (/xnxq/i.test(name)) {
          const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
          debugInfo.push({ name, opts });
        }
      });
      return debugInfo;
    });
    
    console.error(`❌ 无法在教务系统中匹配到目标学期: ${preferredSemester}`);
    if (allSemOptions.length > 0) {
      console.error("教务系统中学期下拉框的可选值如下：");
      allSemOptions.forEach(sel => {
        sel.opts.forEach(opt => {
          console.error(`  - 值: ${opt.value}, 文本: ${opt.text}`);
        });
      });
    }
    throw new Error(`未找到匹配的学期: ${preferredSemester}`);
  }

  // 构造选择器
  let selector = "";
  if (selectResult.selectName) {
    selector = `select[name="${selectResult.selectName}"]`;
  } else if (selectResult.selectId) {
    selector = `select[id="${selectResult.selectId}"]`;
  } else {
    selector = `select:nth-of-type(${selectResult.selectIndex + 1})`;
  }

  console.log(`页面匹配学期：${selectResult.optionText}`);
  
  // 选择选项并等待
  await page.selectOption(selector, selectResult.optionValue);
  await page.waitForTimeout(1500); // 必须等待页面联动更新

  // 验证最终使用学期是否是要求的学期
  const finalValue = await page.$eval(selector, el => el.value);
  if (!finalValue.includes(preferredSemester)) {
    throw new Error(`选择学期后校验失败：最终选中的值 ${finalValue} 与期望值 ${preferredSemester} 不匹配！`);
  }

  console.log(`最终使用学期：${preferredSemester}`);
  return {
    value: selectResult.optionValue,
    label: selectResult.optionText
  };
}

/**
 * 提取学院名称的安全拼音/英文 Slug，供样本文件名使用
 */
function getCollegeSlug(collegeName) {
  const map = {
    "人文": "human",
    "传": "college",
    "动物": "animal",
    "动科": "animal",
    "生命": "life",
    "商": "business",
    "法": "law",
    "医": "medical",
    "工": "engineering",
    "理": "science",
    "材料": "materials",
    "电信": "telecom",
    "机电": "mechatronic",
    "计算机": "computer",
    "数学": "math",
    "物理": "physics",
    "化学": "chemistry",
    "环境": "env",
    "土木": "civil",
    "食品": "food",
    "设计": "design",
    "艺术": "art",
    "体育": "sports",
    "马克思": "marx",
    "国际": "intl",
    "继教": "continue"
  };
  
  let slug = "college";
  for (const [key, val] of Object.entries(map)) {
    if (collegeName.includes(key)) {
      slug = val;
      break;
    }
  }
  return slug;
}

let savedSampleCount = 0;

/**
 * 保存原始专业联动响应样本
 */
function saveMajorResponseSample(rawText, meta, parsedCount, emptyNameCount) {
  if (savedSampleCount >= 3) return;
  savedSampleCount++;

  const sampleDir = path.join(__dirname, ".debug", "major-response-samples");
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }

  const slug = getCollegeSlug(meta.collegeName);
  const safeName = `${meta.collegeCode}-${meta.grade}-${slug}-college`;
  const rawPath = path.join(sampleDir, `${safeName}.raw.txt`);
  const metaPath = path.join(sampleDir, `${safeName}.meta.json`);

  // 脱敏原始响应体：移除敏感 SessionID 或 Cookie 等
  let sanitizedRaw = rawText;
  sanitizedRaw = sanitizedRaw.replace(/JSESSIONID=[a-zA-Z0-9.\-_]+/gi, "JSESSIONID=REDACTED");
  sanitizedRaw = sanitizedRaw.replace(/cookie/gi, "REDACTED");

  fs.writeFileSync(rawPath, sanitizedRaw, "utf-8");

  const metaData = {
    collegeCode: meta.collegeCode,
    collegeName: meta.collegeName,
    grade: meta.grade,
    semester: meta.semester,
    requestUrl: meta.requestUrl,
    method: meta.method || "GET",
    status: meta.status || 200,
    contentType: meta.contentType || (rawText.trim().startsWith("<") ? "text/html" : "application/json"),
    rawLength: rawText.length,
    parsedCount,
    emptyNameCount
  };

  fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), "utf-8");
  console.log(`💾 已保存原始响应样本及元数据至: ${rawPath}`);
}

/**
 * 从不同格式的专业联动响应中解析出专业列表
 */
function parseMajorOptionsFromResponse(raw, meta) {
  if (!raw) return [];
  const { collegeCode = "", collegeName = "", grade = "", semester = "", requestUrl = "" } = meta || {};
  const rawStr = String(raw).trim();
  const items = [];

  const formatItem = (codeVal, nameVal) => {
    const code = typeof codeVal === "string" ? codeVal.trim() : (codeVal ? String(codeVal).trim() : "");
    const name = typeof nameVal === "string" ? nameVal.trim() : (nameVal ? String(nameVal).trim() : "");
    if (!code && !name) return null;

    return {
      code,
      name,
      majorCode: code,
      majorName: name,
      rawLabel: name,
      collegeCode,
      collegeName,
      grade,
      semester
    };
  };

  // 1. 尝试 JSON 数组格式
  try {
    let parsed = null;
    if (rawStr.startsWith("[") || rawStr.startsWith("{")) {
      parsed = JSON.parse(rawStr);
    } else {
      // 提取中括号包裹的疑似 JSON 数组
      const jsonRegex = /\[\s*\{[\s\S]*\}\s*\]/;
      const match = rawStr.match(jsonRegex);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e) {
          // 尝试宽容解析或 eval 提取
          try {
            parsed = eval(`(${match[0]})`);
          } catch (evalErr) {
            // ignore
          }
        }
      }
    }

    if (parsed) {
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed.rows || parsed.data || parsed.list || parsed.majors || parsed.items) || [];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item) continue;
          const codeVal = item.majorCode || item.code || item.value || item.id || item.dm || item.DM || item.zyh || item.ZYH || item.bh || item.BH;
          const nameVal = item.majorName || item.name || item.label || item.text || item.mc || item.MC || item.zymc || item.ZYMC || item.dmmc || item.DMMC || item.title;
          const formatted = formatItem(codeVal, nameVal);
          if (formatted) items.push(formatted);
        }
      }
    }
  } catch (jsonErr) {
    // ignore
  }

  // 2. 如果没有解析出 JSON，尝试 HTML Cheerio 解析
  if (items.length === 0) {
    try {
      const $ = cheerio.load(rawStr, { decodeEntities: false });
      $("option").each((_, el) => {
        const val = $(el).val() || $(el).attr("value") || "";
        const text = $(el).text().trim();
        // 跳过空值和请选择占位符
        if (val) {
          const formatted = formatItem(val, text);
          if (formatted) items.push(formatted);
        }
      });
    } catch (htmlErr) {
      // ignore
    }
  }

  // 3. 正则兜底解析 HTML option 格式
  if (items.length === 0) {
    const optionRegex = /<option\s+[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
    let match;
    while ((match = optionRegex.exec(rawStr)) !== null) {
      const val = match[1];
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (val) {
        const formatted = formatItem(val, text);
        if (formatted) items.push(formatted);
      }
    }
  }

  return items;
}

/**
 * 规范化单个专业数据项，识别需要丢弃的数据
 */
function normalizeMajorItem(item) {
  const majorCodeRaw = item.majorCode || item.code || item.value;
  const majorNameRaw = item.majorName || item.name || item.rawLabel || item.text || item.label;

  const majorName = typeof majorNameRaw === "string" ? majorNameRaw.trim() : (majorNameRaw ? String(majorNameRaw).trim() : "");
  let majorCode = typeof majorCodeRaw === "string" ? majorCodeRaw.trim() : (majorCodeRaw ? String(majorCodeRaw).trim() : "");

  if (!majorCode && !majorName) {
    return { status: "drop_empty", item };
  }
  if (!majorName) {
    return { status: "drop_empty", item };
  }

  const placeholders = ["请选择", "全部", "全部专业", "--请选择--", "请选择专业"];
  if (placeholders.includes(majorName)) {
    return { status: "drop_placeholder", item };
  }

  let generated = false;
  if (!majorCode) {
    majorCode = crypto.createHash("md5").update(majorName).digest("hex").substring(0, 8);
    generated = true;
  }

  return {
    status: "keep",
    generated,
    normalized: {
      code: majorCode,
      name: majorName,
      majorCode,
      majorName,
      collegeCode: item.collegeCode,
      grade: item.grade
    }
  };
}

/**
 * 批量清洗专业 Payload
 */
function cleanMajorsPayload(rawItems) {
  const cleaned = [];
  const droppedEmpty = [];
  const droppedPlaceholder = [];
  let generatedCount = 0;

  for (const item of rawItems) {
    const res = normalizeMajorItem(item);
    if (res.status === "keep") {
      cleaned.push(res.normalized);
      if (res.generated) {
        generatedCount++;
      }
    } else if (res.status === "drop_empty") {
      droppedEmpty.push(res.item);
    } else if (res.status === "drop_placeholder") {
      droppedPlaceholder.push(res.item);
    }
  }

  return {
    cleaned,
    droppedEmpty,
    droppedPlaceholder,
    generatedCount
  };
}

/**
 * 1. 同步 Catalog 基础选项数据
 */
async function syncCatalog(page) {
  console.log("\n=== [步骤 1] 开始抓取 Catalog ===");
  
  // 1. 访问行政班级课表页面获取基础 catalog
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  let html = await page.content();
  let $ = cheerio.load(html);

  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);

  // 重新获取选择学期后的页面内容
  html = await page.content();
  $ = cheerio.load(html);

  // 解析所有可选学期
  const semesters = [];
  $("select[name='xnxqh'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val) semesters.push({ value: val, label: text });
  });

  const matchedOption = semesters.find(s => s.value === semResult.value) || semResult;
  const reorderedSemesters = [
    matchedOption,
    ...semesters.filter(s => s.value !== matchedOption.value)
  ];

  // 使用 Map 管理学院列表，方便根据 code 去重
  const collegeMap = new Map();
  
  function addCollegesFromSelect(selectHtml) {
    const $select = cheerio.load(selectHtml);
    $select("select[name='skyx'] option").each((_, el) => {
      const val = $select(el).attr("value");
      const text = $select(el).text().trim();
      if (val && !text.includes("请选择") && !text.includes("全部")) {
        const cleanName = text.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim();
        if (!collegeMap.has(val)) {
          collegeMap.set(val, { code: val, name: cleanName, rawLabel: text });
        }
      }
    });
  }

  // 提取班级课表页面的学院
  addCollegesFromSelect(html);

  // 解析年级
  const grades = [];
  $("select[name='sknj'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val && /^\d{4}$/.test(val) && !text.includes("选择")) {
      grades.push(val);
    }
  });

  // 2. 依次访问教师课表、教室课表和课程课表以补充学院选项
  const extraPages = [
    { name: "教师课表", path: "/kbcx/kbxx_teacher" },
    { name: "教室课表", path: "/kbcx/kbxx_classroom" },
    { name: "课程课表", path: "/kbcx/kbxx_kc" }
  ];

  for (const item of extraPages) {
    try {
      console.log(`   正在访问 ${item.name} (${item.path}) 补充院系选项...`);
      await gotoPage(page, item.path, { waitUntil: "networkidle" });
      const pageHtml = await page.content();
      addCollegesFromSelect(pageHtml);
    } catch (e) {
      console.warn(`   ⚠️ 补充访问 ${item.name} 失败: ${e.message} (将忽略并继续)`);
    }
  }

  const colleges = Array.from(collegeMap.values());

  // 默认周次
  const weeks = Array.from({ length: 20 }, (_, i) => ({
    value: String(i + 1),
    label: `第${i + 1}周`,
  }));

  const catalogPayload = {
    colleges,
    semesters: reorderedSemesters,
    grades,
    weeks,
    sections: [],
  };

  console.log(`📊 抓取完毕: 学院 ${colleges.length} 个, 学期 ${reorderedSemesters.length} 个, 年级 ${grades.length} 个`);
  
  // 上传至 VPS
  await uploadToVps("/api/admin/sync/catalog", catalogPayload);
  
  // 本地保存一份
  fs.writeFileSync(path.join(__dirname, "last-catalog.json"), JSON.stringify(catalogPayload, null, 2), "utf-8");
  console.log("💾 Catalog 临时数据已保存至本地 last-catalog.json");
  return catalogPayload;
}

/**
 * 2. 同步 Majors 专业映射数据
 */
/**
 * 动态年级过滤函数
 * @param {string} semester 学期，形如 "2025-2026-2" 或 "2025-2026学年第二学期"
 * @param {Object} options 过滤参数
 */
function getActiveGradesBySemester(semester, options = {}) {
  const { originalGrades = [], activeGradeCount = 5 } = options;
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || 'active';
  const syncGradesEnv = process.env.SYNC_GRADES;
  const confirmFullSync = process.env.CONFIRM_FULL_SYNC === 'true';

  const match = semester.match(/^(\d{4})/);
  if (!match) {
    throw new Error(`无法从学期标识 "${semester}" 中提取学年起始年份，请检查学期格式。`);
  }
  const startYear = parseInt(match[1], 10);

  let targetGrades = [];

  if (gradeRangeEnv === 'active') {
    // 默认本科保守保留 activeGradeCount 个年级；sync:class 会传入 4，majors 仍保留 5。
    for (let i = activeGradeCount - 1; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === 'recent4') {
    // 只同步最近 4 个年级
    for (let i = 3; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === 'custom') {
    if (!syncGradesEnv) {
      throw new Error("检测到 SYNC_GRADE_RANGE=custom，但未设置 SYNC_GRADES 环境变量。");
    }
    targetGrades = syncGradesEnv.split(',').map(g => g.trim()).filter(Boolean);
  } else if (gradeRangeEnv === 'all') {
    if (!confirmFullSync) {
      console.error("❌ 检测到 SYNC_GRADE_RANGE=all，但未设置 CONFIRM_FULL_SYNC=true。为避免同步过多历史年级，已中止。");
      process.exit(1);
    }
    return originalGrades;
  } else {
    // 默认 active
    for (let i = activeGradeCount - 1; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  }

  // 过滤出在教务系统原始年级中匹配的部分
  return originalGrades.filter(g => targetGrades.includes(g));
}

/**
 * 2. 同步 Majors 专业映射数据
 */
async function syncMajors(page, catalog) {
  console.log("\n=== [步骤 2] 开始抓取 Majors 专业联动 ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Catalog 数据，请先运行 sync:catalog");
      return;
    }
  }

  const { colleges, grades } = catalog;
  // 打开页面以确保联动操作可用
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);
  const activeSemester = preferredSemester;

  const startYear = parseInt(activeSemester.match(/^(\d{4})/)?.[1] || "2025", 10);
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || 'active';

  // 过滤年级
  let filteredGrades = [];
  try {
    filteredGrades = getActiveGradesBySemester(activeSemester, { originalGrades: grades });
  } catch (err) {
    console.error(`❌ 年级过滤失败: ${err.message}`);
    process.exit(1);
  }

  console.log(`当前学期：${activeSemester}`);
  console.log(`学年起始年份：${startYear}`);
  console.log(`年级过滤模式：${gradeRangeEnv}`);
  console.log(`本次同步年级：${filteredGrades.join(", ")}`);
  console.log(`原始年级数量：${grades.length}`);
  console.log(`过滤后年级数量：${filteredGrades.length}`);
  console.log(`本次联动请求数：${colleges.length} × ${filteredGrades.length} = ${colleges.length * filteredGrades.length}`);

  const allMajors = [];

  let count = 0;
  for (const college of colleges) {
    for (const grade of filteredGrades) {
      count++;
      console.log(`   [${count}/${colleges.length * filteredGrades.length}] 抓取中: ${college.name} - ${grade}级 ...`);
      
      let responseText = "";
      let success = false;
      let dropdownHtml = "";
      
      // 1. 优先使用 evaluate fetch
      try {
        responseText = await page.evaluate(async (params) => {
          const res = await fetch(`/kbcx/getZyByAjax?skyx=${params.collegeCode}&sknj=${params.grade}`);
          return res.text();
        }, { collegeCode: college.code, grade });
        success = true;
      } catch (ajaxErr) {
        console.warn(`      ⚠️  Ajax 抓取专业失败 (${ajaxErr.message})，尝试使用 DOM 联动 Fallback...`);
      }

      let majors = [];
      if (success && responseText) {
        try {
          majors = parseMajorOptionsFromResponse(responseText, {
            collegeCode: college.code,
            collegeName: college.name,
            grade,
            semester: activeSemester,
            requestUrl: `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade}`
          });
        } catch (e) {
          console.warn(`      ⚠️  Ajax 响应解析失败: ${e.message}，将尝试 DOM Fallback...`);
          success = false;
        }
      }

      // 2. 如果 evaluate fetch 失败，采用页面级 DOM 操作联动
      if (!success || majors.length === 0) {
        try {
          // 选择学院
          await page.selectOption("select[name='skyx']", college.code);
          // 选择年级
          await page.selectOption("select[name='sknj']", grade);
          // 等待 DOM 反应
          await page.waitForTimeout(800);
          
          // 获取专业下拉框的 HTML 内容，然后用我们的通用 parser 解析
          dropdownHtml = await page.evaluate(() => {
            const sel = document.querySelector("select[name='skzy']");
            return sel ? sel.outerHTML : "";
          });

          if (dropdownHtml) {
            majors = parseMajorOptionsFromResponse(dropdownHtml, {
              collegeCode: college.code,
              collegeName: college.name,
              grade,
              semester: activeSemester,
              requestUrl: "DOM_SELECT_skzy"
            });
          }
        } catch (domErr) {
          console.error(`      ❌ DOM 联动 Fallback 也彻底失败: ${domErr.message}`);
        }
      }

      if (majors.length > 0) {
        const rawCount = majors.length;
        const emptyNameCount = majors.filter(m => !String(m.name || m.majorName || m.rawLabel || "").trim()).length;
        const validCount = rawCount - emptyNameCount;
        
        console.log(`      原始选项数：${rawCount}`);
        console.log(`      有效专业数：${validCount}`);
        console.log(`      空名称数：${emptyNameCount}`);

        if (emptyNameCount === rawCount) {
          console.warn(`      ⚠️ 严重警告：本次联动只解析到专业 code，没有解析到专业名称，请检查 parser 或 raw response 样本。`);
        }

        if (savedSampleCount < 3) {
          saveMajorResponseSample(
            responseText || dropdownHtml,
            {
              collegeCode: college.code,
              collegeName: college.name,
              grade,
              semester: activeSemester,
              requestUrl: responseText ? `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade}` : "DOM_SELECT_skzy",
              method: responseText ? "GET" : "DOM_INTERACTION",
              status: 200,
              contentType: responseText ? (responseText.trim().startsWith("<") ? "text/html" : "application/json") : "text/html"
            },
            rawCount,
            emptyNameCount
          );
        }

        allMajors.push(...majors);
      } else {
        console.log(`      没有专业数据。`);
      }

      await sleep(300); // 适度延时保护教务系统
    }
  }

  console.log(`📊 专业联动抓取完毕，共整理出 ${allMajors.length} 个原始专业数据。`);
  
  // 1. 进行数据清洗
  const { cleaned, droppedEmpty, droppedPlaceholder, generatedCount } = cleanMajorsPayload(allMajors);
  const sampleDroppedItems = [...droppedEmpty, ...droppedPlaceholder].slice(0, 10);

  console.log("\n🧹 === [专业清洗数据统计] ===");
  console.log(`- rawMajorsCount: ${allMajors.length}`);
  console.log(`- cleanedMajorsCount: ${cleaned.length}`);
  console.log(`- droppedEmptyNameCount: ${droppedEmpty.length}`);
  console.log(`- droppedPlaceholderCount: ${droppedPlaceholder.length}`);
  console.log(`- generatedMajorCodeCount: ${generatedCount}`);
  console.log(`- sampleDroppedItems (前 10 条):`, JSON.stringify(sampleDroppedItems, null, 2));
  console.log("=============================\n");

  if (cleaned.length === 0) {
    console.error(`❌ 没有有效专业数据，已停止上传。`);
    console.error(`请检查：`);
    console.error(`1. 当前学期是否正确。`);
    console.error(`2. major-response-samples 中的 raw 响应格式。`);
    console.error(`3. parseMajorOptionsFromResponse 是否正确解析 option text / JSON name 字段。`);
    throw new Error("没有有效专业数据，已停止上传。");
  }

  // 2. 保存调试文件
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  fs.writeFileSync(path.join(debugDir, "last-majors-raw.json"), JSON.stringify(allMajors, null, 2), "utf-8");
  const debugUploadPath = path.join(debugDir, "last-majors-upload.json");
  fs.writeFileSync(debugUploadPath, JSON.stringify(cleaned, null, 2), "utf-8");
  
  // 3. 统计上传摘要数据
  const payloadStr = JSON.stringify(cleaned);
  const payloadSizeKB = (payloadStr.length / 1024).toFixed(2);
  
  const collegeCodes = new Set(cleaned.map(m => m.collegeCode));
  const majorGrades = new Set(cleaned.map(m => m.grade));
  
  // 统计每个学院的专业数以找出最大值
  const collegeMajorCounts = {};
  cleaned.forEach(m => {
    collegeMajorCounts[m.collegeCode] = (collegeMajorCounts[m.collegeCode] || 0) + 1;
  });
  const largestCollegeMajorCount = Math.max(...Object.values(collegeMajorCounts), 0);
  
  const hasEmptyCollegeCode = cleaned.some(m => !m.collegeCode);
  const hasEmptyMajorCode = cleaned.some(m => !m.code);
  
  // 重复 key 校验
  const seenKeys = new Set();
  let hasDuplicateKey = false;
  for (const m of cleaned) {
    const key = `${m.collegeCode}_${m.grade}_${m.code}`;
    if (seenKeys.has(key)) {
      hasDuplicateKey = true;
      break;
    }
    seenKeys.add(key);
  }
  
  console.log("\n📦 === [上传摘要] ===");
  console.log(`- collegesCount: ${collegeCodes.size}`);
  console.log(`- gradesCount: ${majorGrades.size}`);
  console.log(`- majorsCount: ${cleaned.length}`);
  console.log(`- payloadSizeKB: ${payloadSizeKB} KB`);
  console.log(`- semester: ${activeSemester}`);
  console.log(`- gradeRange: ${gradeRangeEnv}`);
  console.log(`- largestCollegeMajorCount: ${largestCollegeMajorCount}`);
  console.log(`- 是否存在空 collegeCode: ${hasEmptyCollegeCode ? "⚠️ 是" : "否"}`);
  console.log(`- 是否存在空 majorCode: ${hasEmptyMajorCode ? "⚠️ 是" : "否"}`);
  console.log(`- 是否存在重复 key: ${hasDuplicateKey ? "⚠️ 是" : "否"}`);
  console.log("=====================\n");

  // 4. 上传至 VPS 并做详细的错误捕捉
  try {
    await uploadToVps("/api/admin/sync/majors", cleaned);
  } catch (err) {
    console.error(`❌ Majors 数据同步至 VPS 失败！`);
    if (err.response) {
      console.error(`- status: ${err.response.status}`);
      console.error(`- response body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error(`- error message: ${err.message}`);
    }
    console.error(`- request payload size: ${payloadSizeKB} KB`);
    console.error(`- 本地调试文件路径: ${debugUploadPath}`);
    throw err;
  }
  
  fs.writeFileSync(path.join(__dirname, "last-majors.json"), JSON.stringify(cleaned, null, 2), "utf-8");
  console.log("💾 Majors 临时数据已保存至本地 last-majors.json");
  return cleaned;
}

/**
 * 3. 同步 Class Schedules 班级课表
 */
/**
 * 获取当前登录学生的班级名称
 */
async function getCurrentStudentClass(page) {
  console.log("🔍 正在定位当前登录学生的班级信息...");
  try {
    await gotoPage(page, "/xskb/xskb_list.do", { waitUntil: "networkidle" });
    const htmlText = await page.content();
    const $ = cheerio.load(htmlText);
    
    const bodyText = $("body").text();
    let className = "";
    
    // 匹配类似 "班级：[123456] 动物医学2023级1班" 或 "行政班级：动物医学221"
    const match = bodyText.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
    if (match) {
      className = match[1].trim();
      console.log(`🎉 成功识别当前登录学生班级: ${className}`);
      return className;
    }

    // 备选 DOM 遍历
    $("td, th, span, div").each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("班级：") || text.includes("行政班级：") || text.includes("班级:")) {
        const m = text.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
        if (m) {
          className = m[1].trim();
        }
      }
    });

    if (className) {
      console.log(`🎉 从页面 DOM 匹配当前登录学生班级: ${className}`);
      return className;
    }
    
    console.warn("⚠️ 个人课表页面中未提取到明确班级文本。");
    return "";
  } catch (error) {
    console.error(`⚠️ 抓取当前学生班级出错: ${error.message}`);
    return "";
  }
}

/**
 * 3. 同步 Class Schedules 班级课表
 */
async function syncClassSchedules(page, catalog, majors) {
  console.log("\n=== [步骤 3] 开始抓取班级课表 Class Schedules ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Catalog 数据，请先运行 sync:catalog");
      return;
    }
  }

  if (!majors) {
    if (fs.existsSync(path.join(__dirname, "last-majors.json"))) {
      majors = JSON.parse(fs.readFileSync(path.join(__dirname, "last-majors.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Majors 数据，请先运行 sync:majors");
      return;
    }
  }

  const debugDir = path.join(__dirname, ".debug");
  const rawPagesDir = path.join(debugDir, "raw-pages");
  if (!fs.existsSync(rawPagesDir)) {
    fs.mkdirSync(rawPagesDir, { recursive: true });
  }

  const PROGRESS_PATH = path.join(debugDir, "sync-progress.json");
  let progress = { completed: [] };
  if (fs.existsSync(PROGRESS_PATH)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
      console.log(`ℹ️ 加载到本地同步进度，已完成 ${progress.completed.length} 个专业。`);
    } catch (e) {
      console.warn("⚠️ 读取断点进度失败，将全新抓取");
    }
  }

  // 默认使用最新学期
  const activeSemester = catalog.semesters[0]?.value || "2025-2026-2";
  console.log(`📅 抓取学期: ${activeSemester}`);

  // 定位当前学生班级
  const currentStudentClass = await getCurrentStudentClass(page);
  if (currentStudentClass) {
    console.log(`ℹ️ 当前登录学生班级仅用于诊断参考: ${currentStudentClass}`);
  }

  const collegeNameByCode = new Map((catalog.colleges || []).map((college) => [String(college.code), college.name]));
  const noScheduleCachePath = path.join(debugDir, "no-schedule-majors.json");
  const classNameCandidatesPath = path.join(debugDir, "class-name-candidates.json");
  let noScheduleMajors = readJsonArray(noScheduleCachePath);
  let classNameCandidateRecords = readJsonArray(classNameCandidatesPath);
  const skipNoScheduleCache = getEnvFlag("SYNC_SKIP_NO_SCHEDULE_CACHE", true);
  const recheckNoSchedule = getEnvFlag("SYNC_RECHECK_NO_SCHEDULE", false);
  const cachedNoScheduleKeys = new Set(
    noScheduleMajors
      .filter((item) => item && item.semester === activeSemester)
      .map((item) => getMajorIdentityKey({
        collegeCode: item.collegeCode,
        grade: item.grade,
        code: item.majorCode,
      }, item.semester))
  );

  // 解析环境变量过滤条件
  const syncCollegeCodes = process.env.SYNC_CLASS_COLLEGE_CODES ? process.env.SYNC_CLASS_COLLEGE_CODES.split(",").map(c => c.trim()).filter(Boolean) : null;
  const syncGrades = process.env.SYNC_CLASS_GRADES ? process.env.SYNC_CLASS_GRADES.split(",").map(g => g.trim()).filter(Boolean) : null;
  const syncMajorCodes = process.env.SYNC_CLASS_MAJOR_CODES ? process.env.SYNC_CLASS_MAJOR_CODES.split(",").map(m => m.trim()).filter(Boolean) : null;
  const isFiltered = !!(syncCollegeCodes || syncGrades || syncMajorCodes);

  if (isFiltered) {
    console.log("ℹ️ 课表同步已启用环境变量限制过滤：");
    if (syncCollegeCodes) console.log(`   - 学院限制: ${syncCollegeCodes.join(", ")}`);
    if (syncGrades) console.log(`   - 年级限制: ${syncGrades.join(", ")}`);
    if (syncMajorCodes) console.log(`   - 专业代码限制: ${syncMajorCodes.join(", ")}`);
  } else {
    console.log("ℹ️ 课表同步未设置环境变量限制。默认仅同步当前学年起最近 4 个在校活跃年级，并启用限速。");
  }

  if (skipNoScheduleCache && !recheckNoSchedule) {
    console.log(`ℹ️ 已启用无排课缓存跳过策略，本学期缓存命中候选 ${cachedNoScheduleKeys.size} 个。`);
  } else if (recheckNoSchedule) {
    console.log("ℹ️ SYNC_RECHECK_NO_SCHEDULE=true，将重新检查此前确认无排课的专业。");
  }

  const syncClassScope = process.env.SYNC_CLASS_SCOPE || "";

  const isFiveYearMajor = (name) => {
    const n = name || "";
    return n.includes("动物医学") || n.includes("建筑学") || n.includes("临床医学") || n.includes("医学");
  };

  // 筛选出目标专业
  const targetMajors = majors.filter(major => {
    // 1. 如果指定了 collegeCodes 限制且当前 major 不在其中，过滤掉
    if (syncCollegeCodes && !syncCollegeCodes.includes(major.collegeCode)) {
      return false;
    }
    // 2. 如果指定了 grades 限制且当前 major 不在其中，过滤掉
    if (syncGrades && !syncGrades.includes(major.grade)) {
      const includeFiveYear = getEnvFlag("SYNC_INCLUDE_FIVE_YEAR", true);
      const isFiveYear = isFiveYearMajor(major.name || major.majorName);
      if (includeFiveYear && isFiveYear && major.grade === "2021") {
        // 允许抓取五年制专业的2021级
      } else {
        return false;
      }
    }
    // 3. 如果指定了 majorCodes 限制且当前 major 不在其中，过滤掉
    if (syncMajorCodes && !syncMajorCodes.includes(major.code)) {
      return false;
    }

    // 4. 如果没有指定任何精准过滤限制
    if (!isFiltered) {
      if (syncClassScope !== "all") {
        return false;
      }

      let activeGrades = [];
      try {
        activeGrades = getActiveGradesBySemester(activeSemester, { originalGrades: catalog.grades, activeGradeCount: 4 });
      } catch (e) {
        // 兜底：如果报错，则默认只同步最近 4 个年级
        const currentYear = new Date().getFullYear();
        for (let i = 3; i >= 0; i--) {
          activeGrades.push(String(currentYear - i));
        }
      }
      if (!activeGrades.includes(major.grade)) {
        return false;
      }
    }

    return true;
  });

  if (!isFiltered && syncClassScope !== "all") {
    console.log("⚠️ 未检测到精准同步环境变量限制 (SYNC_CLASS_COLLEGE_CODES 等)，且未显式设置 SYNC_CLASS_SCOPE=all。跳过全校同步。");
  }

  console.log(`🎯 匹配的目标专业总计: ${targetMajors.length} 个。`);

  const effectiveTargetMajors = targetMajors.filter((major) => {
    if (!skipNoScheduleCache || recheckNoSchedule) {
      return true;
    }
    const key = getMajorIdentityKey(major, activeSemester);
    if (cachedNoScheduleKeys.has(key)) {
      console.log(`   跳过已确认无排课专业: ${major.grade}级 - ${major.name} (${major.code})`);
      return false;
    }
    return true;
  });

  if (effectiveTargetMajors.length !== targetMajors.length) {
    console.log(`⏭️ 已按无排课缓存跳过 ${targetMajors.length - effectiveTargetMajors.length} 个专业，本轮实际待判断 ${effectiveTargetMajors.length} 个。`);
  }

  // 剔除已完成部分
  const pendingMajors = effectiveTargetMajors.filter(major => !hasCompletedMajor(progress, major, activeSemester));

  console.log(`🔄 本轮待同步专业: ${pendingMajors.length} 个。`);

  // 打开行政班级课表页面以确保 Ajax 环境可用
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  let totalCoursesFetched = 0;
  let totalDedupledCount = 0;
  let totalGroupedCount = 0;
  const skipNoScheduleCount = targetMajors.length - effectiveTargetMajors.length;
  let newNoScheduleCount = 0;

  const allClassSchedules = [];
  let count = 0;

  for (const major of pendingMajors) {
    count++;
    console.log(`   [${count}/${pendingMajors.length}] 正在抓取: ${major.grade}级 - ${major.name} 专业课表 ...`);

    try {
      // 页面内 POST 请求课表 HTML
      const htmlText = await page.evaluate(async (params) => {
        const formBody = new URLSearchParams({
          xnxqh: params.semester,
          skyx: params.collegeCode,
          sknj: params.grade,
          skzy: params.majorCode,
          zc1: "",
          zc2: "",
          jc1: "",
          jc2: "",
        }).toString();

        const res = await fetch("/kbcx/kbxx_xzb_ifr", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formBody,
        });
        return res.text();
      }, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
      });

      // 保存 raw HTML 到本地，便于调试且不提交到 git
      const rawHtmlPath = path.join(rawPagesDir, `class_${major.grade}_${major.code}.html`);
      fs.writeFileSync(rawHtmlPath, htmlText, "utf-8");

      const candidateResult = parser.extractClassNameCandidates(htmlText, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
      });
      classNameCandidateRecords = upsertClassNameCandidateRecord(classNameCandidateRecords, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
        rawHtmlPath,
        classNames: candidateResult.classNames || [],
        candidates: (candidateResult.candidates || []).slice(0, 80),
        checkedAt: new Date().toISOString(),
      });
      writeJsonFile(classNameCandidatesPath, classNameCandidateRecords);
      console.log(`      班级文本候选: ${(candidateResult.classNames || []).join(", ") || "未发现"}`);

      // 解析课表 HTML
      const parsed = parser.parseClassScheduleIfrHtml(htmlText, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
      });

      // 规范化课表
      const courses = normalizer.normalizeCourseList(parsed.courses || [], {
        semester: activeSemester,
        sourceType: "class",
        audienceType: "student",
      });

      totalCoursesFetched += courses.length;
      if (courses.length > 0) {
        const seenKeys = new Set();
        const uniqueCourses = courses.filter(c => {
          const key = [
            c.courseName || "",
            c.weekday || "",
            c.startSection || "",
            c.endSection || "",
            c.startWeek || "",
            c.endWeek || "",
            c.teacherName || "",
            c.classroom || "",
          ].join("_");
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
        const dedupedDiff = courses.length - uniqueCourses.length;
        totalDedupledCount += dedupedDiff;

        const groupMap = {};
        uniqueCourses.forEach(c => {
          const key = [
            c.courseName || "",
            c.weekday || "",
            c.startSection || "",
            c.endSection || "",
            c.startWeek || "",
            c.endWeek || "",
          ].join("_");
          groupMap[key] = (groupMap[key] || 0) + 1;
        });
        let groupedCoursesNum = 0;
        Object.keys(groupMap).forEach(key => {
          if (groupMap[key] > 1) {
            groupedCoursesNum++;
          }
        });
        totalGroupedCount += groupedCoursesNum;
      }

      if (courses.length === 0) {
        newNoScheduleCount++;
        const noScheduleRecord = {
          semester: activeSemester,
          collegeCode: major.collegeCode,
          collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
          grade: major.grade,
          majorCode: major.code,
          majorName: major.name,
          checkedAt: new Date().toISOString(),
        };
        noScheduleMajors = upsertNoScheduleMajor(noScheduleMajors, noScheduleRecord);
        writeJsonFile(noScheduleCachePath, noScheduleMajors);
        console.log(`      没有排课数据，已记录到 ${noScheduleCachePath}`);

        // 将该专业标记为已完成
        markCompletedMajor(progress, major, activeSemester);
        writeJsonFile(PROGRESS_PATH, progress);
        await waitBetweenClassSyncRequests(isFiltered);
        continue;
      }

      const beforeNoScheduleCount = noScheduleMajors.length;
      noScheduleMajors = removeNoScheduleMajor(noScheduleMajors, major, activeSemester);
      if (noScheduleMajors.length !== beforeNoScheduleCount) {
        writeJsonFile(noScheduleCachePath, noScheduleMajors);
        console.log("      此前无排课缓存已失效，本次抓到课程并已移除缓存记录。");
      }

      // 按可靠行政班名分组；无法识别行政班时降级为专业聚合课表，不丢弃课程。
      const classes = normalizer.buildClassScheduleEntries(courses, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
      });

      if (classes.length > 0) {
        const aggregateCount = classes.filter((item) => item.isAggregated).length;
        const classCount = classes.length - aggregateCount;
        console.log(`      整理课表条目: 行政班 ${classCount} 个，专业聚合 ${aggregateCount} 个 (${classes.map(c => c.className).join(", ")})`);
        allClassSchedules.push(...classes);
      }

      // 将该专业标记为已完成
      markCompletedMajor(progress, major, activeSemester);
      writeJsonFile(PROGRESS_PATH, progress);

    } catch (err) {
      console.error(`      ⚠️  抓取失败: ${err.message}`);
    }

    // 随机限流延迟：如果是全量同步则进一步限速保护教务系统
    await waitBetweenClassSyncRequests(isFiltered);
  }

  console.log(`📊 班级课表抓取完毕，共整理出 ${allClassSchedules.length} 个行政班级的课表。`);

  if (allClassSchedules.length > 0) {
    // 无论后续上传成功与否，强制在上传前保存完整全量文件
    const { latestPath } = saveFullClassSchedules(allClassSchedules, activeSemester);

    // 写入 manifest：.debug/class-schedules-manifest.json
    const manifestPath = path.join(debugDir, "class-schedules-manifest.json");
    let checksum = "";
    try {
      const fileContent = fs.readFileSync(latestPath, "utf-8");
      checksum = crypto.createHash("md5").update(fileContent).digest("hex");
    } catch (e) {
      console.warn(`⚠️ 计算 class-schedules-latest.json 的 checksum 失败: ${e.message}`);
    }

    let syncClientVersion = "1.0.0";
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
      syncClientVersion = pkg.version || "1.0.0";
    } catch (e) {}

    const adminClassCount = allClassSchedules.filter(
      (item) => item.displayType === "class-schedule" && !item.isAggregated
    ).length;
    const majorAggregateCount = allClassSchedules.length - adminClassCount;

    const manifestData = {
      semester: activeSemester,
      grades: syncGrades || (catalog.grades || []),
      crawledAt: new Date().toISOString(),
      source: "100.fosu.edu.cn",
      classScheduleCount: allClassSchedules.length,
      adminClassCount,
      majorAggregateCount,
      checksum,
      syncClientVersion
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");
    console.log(`💾 班级课表抓取清单已保存至: ${manifestPath}`);

    // 如果设置了 crawl-only 模式，则仅抓取并保存本地，不执行上传
    if (getEnvFlag("SYNC_CLASS_CRAWL_ONLY", false)) {
      console.log(`\n🎉 [Crawl Only] 抓取完成！`);
      console.log(`📁 完整课表数据已保存至: ${latestPath}`);
      console.log(`📊 共抓取班级课表数量 (itemCount): ${allClassSchedules.length} 条`);
      printPowerShellCommands();
      return allClassSchedules;
    }

    try {
      // 传入最新保存的文件路径，作为断点续传进度的 sourceFilePath
      await uploadClassSchedulesInChunks(allClassSchedules, debugDir, latestPath, activeSemester);
      console.log(`✅ 本轮抓取的班级课表数据同步完成！`);
    } catch (uploadError) {
      console.error(`❌ 同步至 VPS 失败：${uploadError.message}`);
      console.error(`⚠️ 完整课表数据已保存至 .debug/class-schedules-latest.json，可稍后执行 upload-only 继续上传。`);
      printPowerShellCommands();
      throw uploadError;
    }
  } else {
    console.log("ℹ️ 本轮没有新抓取到任何班级课表，无需上传。");
  }

  const finalAggregateCount = allClassSchedules.filter((item) => item.isAggregated).length;
  const finalClassCount = allClassSchedules.length - finalAggregateCount;
  const finalTotalSkipCount = skipNoScheduleCount + newNoScheduleCount;

  console.log("\n================ [同步任务总结报告] ================");
  console.log(`- 行政班数量: ${finalClassCount} 个`);
  console.log(`- 专业共享课表数量: ${finalAggregateCount} 个`);
  console.log(`- 课程总数: ${totalCoursesFetched} 门`);
  console.log(`- 重复课程去重数量: ${totalDedupledCount} 门`);
  console.log(`- 分组课程数量: ${totalGroupedCount} 组`);
  console.log(`- 跳过无课表专业数量: ${finalTotalSkipCount} 个 (其中缓存跳过 ${skipNoScheduleCount}，本次新确认 ${newNoScheduleCount})`);
  console.log("==================================================\n");

  // 如果全部都已同步完成，重置进度文件
  const allEffectiveTargetsDone = effectiveTargetMajors.every((major) => hasCompletedMajor(progress, major, activeSemester));
  if (allEffectiveTargetsDone) {
    try {
      fs.unlinkSync(PROGRESS_PATH);
      console.log("🎉 所有目标专业已同步完成，进度已重置。");
    } catch (e) {}
  }

  return allClassSchedules;
}

/**
 * 预检同步环境与代理状态
 */
function runPreflight() {
  console.log("\n================ [Preflight 预检环境配置] ================");
  console.log(`- .env path: ${envPath}`);
  console.log(`- FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);
  console.log(`- PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "未配置"}`);
  
  const syncClassGrades = process.env.SYNC_CLASS_GRADES || "未配置";
  const syncGrades = process.env.SYNC_GRADES || "未配置";
  console.log(`- SYNC_CLASS_GRADES (班级课表同步使用): ${syncClassGrades}`);
  console.log(`- SYNC_GRADES (专业同步使用): ${syncGrades}`);
  
  const tokenExists = Boolean(process.env.ADMIN_API_TOKEN);
  console.log(`- ADMIN_API_TOKEN: ${tokenExists ? "已配置" : "❌ 未配置！(可能会导致 VPS 校验失败)"}`);

  if (INITIAL_DETECTED_PROXIES.length > 0) {
    console.warn(`⚠️ 检测到代理环境变量:`);
    INITIAL_DETECTED_PROXIES.forEach(([name, value]) => {
      console.warn(`   - ${name}=${value}`);
      if (value.includes("127.0.0.1:10808") || value.includes("localhost:10808")) {
        console.warn("   ⚠️ 【警告】检测到代理指向 127.0.0.1:10808，可能是 v2rayN 系统代理残留，会导致上传 VPS 失败！");
      }
    });
  } else {
    console.log("- 代理环境变量: 未检测到");
  }

  const disableProxy = String(process.env.SYNC_DISABLE_PROXY || "true").toLowerCase() !== "false";
  console.log(`- SYNC_DISABLE_PROXY: ${disableProxy}`);
  if (disableProxy) {
    console.log("ℹ️ 已启用强制禁用代理配置。所有上传阶段将强制不使用代理。");
  }
  console.log("========================================================\n");
}

/**
 * 输出最终同步任务总结报告
 */
function printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes) {
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const classScheduleCount = allClassSchedules ? allClassSchedules.length : 0;
  const adminClassCount = allClassSchedules ? allClassSchedules.filter(
    (item) => item.displayType === "class-schedule" && !item.isAggregated
  ).length : 0;
  const majorAggregateCount = classScheduleCount - adminClassCount;

  const teacherScheduleCount = (resources && resources.teacherSchedules) ? resources.teacherSchedules.length : 0;
  const classroomScheduleCount = (resources && resources.classroomSchedules) ? resources.classroomSchedules.length : 0;
  const courseScheduleCount = (resources && resources.courseSchedules) ? resources.courseSchedules.length : 0;

  const snapshotVersion = verifyRes?.status?.snapshotVersion || verifyRes?.releaseStatus?.activeReleaseVersion || "未知";
  const bootstrapDataSource = verifyRes?.bootstrap?.dataSource || "未知";
  const isActivated = verifyRes?.bootstrap?.success ? "已成功发布并激活" : "❌ 未确认激活成功";
  const clientDataVersion = verifyRes?.bootstrap?.version || verifyRes?.status?.snapshotVersion || "未知";

  console.log("\n=================== [一键同步任务总结报告] ===================");
  console.log(`- 当前学期 (preferredSemester): ${preferredSemester}`);
  console.log(`- catalog 学院数量: ${catalog && catalog.colleges ? catalog.colleges.length : 0} 个`);
  console.log(`- majors 专业数量: ${majors ? majors.length : 0} 个`);
  console.log(`- classScheduleCount (班级课表数): ${classScheduleCount} 条`);
  console.log(`- adminClassCount (行政班数量): ${adminClassCount} 个`);
  console.log(`- majorAggregateCount (专业共享数量): ${majorAggregateCount} 个`);
  console.log(`- teacherScheduleCount (教师课表数): ${teacherScheduleCount} 条`);
  console.log(`- classroomScheduleCount (教室课表数): ${classroomScheduleCount} 条`);
  console.log(`- courseScheduleCount (课程课表数): ${courseScheduleCount} 条`);
  console.log(`- snapshotVersion (线上快照版本): ${snapshotVersion}`);
  console.log(`- bootstrap dataSource (最终数据源): ${bootstrapDataSource}`);
  console.log(`- 发布状态: ${isActivated}`);
  console.log(`- 小程序应看到的数据版本 (clientDataVersion): ${clientDataVersion}`);
  console.log("============================================================\n");
}

/**
 * 处理一键完整同步 (sync:fresh)
 */
async function handleFreshSync(page) {
  console.log("\n================ [开始执行一键完整同步 (sync:fresh)] ================");

  // 1. 同步 catalog 并上传 VPS
  const catalog = await syncCatalog(page);

  // 2. 同步 majors 并上传 VPS
  const majors = await syncMajors(page, catalog);

  // 3. 同步 class 课表并上传 VPS
  delete process.env.SYNC_CLASS_CRAWL_ONLY; 
  const allClassSchedules = await syncClassSchedules(page, catalog, majors);
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("一键完整同步抓取班级课表结果为空，同步中断！");
  }

  // 4. 派生资源维度数据并上传 VPS
  console.log("\n[sync:fresh] 正在基于新抓取的班级课表派生资源维度...");
  const resources = await handleResourcesSync(["teacher", "classroom", "course"]);

  // 5. 离线发布与激活
  console.log("\n[sync:fresh] 正在以离线发布模式 (SYNC_RELEASE_OFFLINE=true) 生成发布并激活线上快照...");
  process.env.SYNC_RELEASE_OFFLINE = "true";
  await handleOfflineRelease();

  // 6. 校验线上接口
  console.log("\n[sync:fresh] 同步动作已完成，开始校验线上端点...");
  let verifyRes = null;
  try {
    verifyRes = await verifyEndpoints();
  } catch (err) {
    console.error(`⚠️ 校验线上接口出现异常: ${err.message}`);
  }

  // 7. 打印报告
  printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes);
}

/**
 * 处理一键快速同步 (sync:quick)
 */
async function handleQuickSync(page) {
  console.log("\n================ [开始执行一键快速同步 (sync:quick)] ================");

  // 1. 从历史缓存中加载 catalog 和 majors
  const catalogPath = path.join(__dirname, "last-catalog.json");
  const majorsPath = path.join(__dirname, "last-majors.json");
  if (!fs.existsSync(catalogPath) || !fs.existsSync(majorsPath)) {
    throw new Error("没有找到本地 catalog 或 majors 历史缓存！请先运行一次 npm run sync:fresh。");
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const majors = JSON.parse(fs.readFileSync(majorsPath, "utf-8"));

  // 2. 重新抓取班级课表并上传 VPS
  delete process.env.SYNC_CLASS_CRAWL_ONLY;
  const allClassSchedules = await syncClassSchedules(page, catalog, majors);
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("快速同步抓取班级课表结果为空，同步中断！");
  }

  // 3. 派生资源维度数据并上传 VPS
  console.log("\n[sync:quick] 正在基于新抓取的班级课表派生资源维度...");
  const resources = await handleResourcesSync(["teacher", "classroom", "course"]);

  // 4. 离线发布与激活
  console.log("\n[sync:quick] 正在以离线发布模式 (SYNC_RELEASE_OFFLINE=true) 生成发布并激活线上快照...");
  process.env.SYNC_RELEASE_OFFLINE = "true";
  await handleOfflineRelease();

  // 5. 校验线上接口
  console.log("\n[sync:quick] 同步动作已完成，开始校验线上端点...");
  let verifyRes = null;
  try {
    verifyRes = await verifyEndpoints();
  } catch (err) {
    console.error(`⚠️ 校验线上接口出现异常: ${err.message}`);
  }

  // 6. 打印报告
  printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes);
}

/**
 * 主程序入口
 */
async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || "all";

  // 如果是一键同步任务，则强制执行环境预检
  if (action === "fresh" || action === "quick") {
    runPreflight();
  }

  // 1. 拦截并处理 upload-only 模式，免去网络诊断和浏览器初始化
  const uploadOnlyMode = getEnvFlag("SYNC_CLASS_UPLOAD_ONLY", false);
  if (uploadOnlyMode || action === "upload-cache") {
    console.log("ℹ️ 将直接执行本地课表缓存上传，不重新打开浏览器抓取。");
    await handleUploadOnly();
    return;
  }

  // 1.5. 拦截并处理离线 release 模式
  const offlineMode = getEnvFlag("SYNC_RELEASE_OFFLINE", false);
  if (action === "release" && offlineMode) {
    await handleOfflineRelease();
    return;
  }

  if (action === "resources") {
    await handleResourcesSync(["teacher", "classroom", "course"]);
    return;
  }

  if (action === "teachers" || action === "classrooms" || action === "courses") {
    const typeMap = {
      teachers: "teacher",
      classrooms: "classroom",
      courses: "course",
    };
    await handleResourcesSync([typeMap[action]]);
    return;
  }

  // 2. 网络连接检测
  const isNetOk = await diagnose();
  if (!isNetOk) {
    if (action === "release") {
      console.warn("⚠️ 本地网络未通过校园网/VPN诊断！无法在线抓取数据。");
      console.log("💡 提示: 检测到当前非校园网环境，你可以使用离线模式直接打包本地已抓取的缓存发布快照：");
      console.log("   PowerShell 命令: $env:SYNC_RELEASE_OFFLINE=\"true\"; npm run sync:release");
    } else {
      console.error("❌ 本地网络未通过校园网/VPN诊断，中止同步任务！");
      printPowerShellCommands();
    }
    process.exit(1);
  }

  // 3. 初始化 Playwright 并启动
  const { browser, context } = await initBrowserContext();
  const page = await context.newPage();

  try {
    // 4. 校验 Session 状态
    const isSessionOk = await checkSession(page);
    if (!isSessionOk) {
      process.exit(1);
    }

    let catalog, majors;

    if (action === "catalog") {
      await syncCatalog(page);
    } else if (action === "majors") {
      await syncMajors(page);
    } else if (action === "class") {
      await syncClassSchedules(page);
    } else if (action === "fresh") {
      await handleFreshSync(page);
    } else if (action === "quick") {
      await handleQuickSync(page);
    } else if (action === "release") {
      // 暴力快照发布默认环境变量配置
      if (!process.env.SYNC_CLASS_GRADES) {
        process.env.SYNC_CLASS_GRADES = "2025,2024,2023,2022";
      }
      if (process.env.SYNC_INCLUDE_FIVE_YEAR === undefined) {
        process.env.SYNC_INCLUDE_FIVE_YEAR = "true";
      }
      if (process.env.SYNC_SKIP_NO_SCHEDULE_CACHE === undefined) {
        process.env.SYNC_SKIP_NO_SCHEDULE_CACHE = "true";
      }
      if (process.env.SYNC_RECHECK_NO_SCHEDULE === undefined) {
        process.env.SYNC_RECHECK_NO_SCHEDULE = "false";
      }
      if (process.env.SYNC_CLASS_SCOPE === undefined) {
        process.env.SYNC_CLASS_SCOPE = "all";
      }

      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      process.env.SYNC_CLASS_CRAWL_ONLY = "true";
      const allClassSchedules = await syncClassSchedules(page, catalog, majors);
      if (!allClassSchedules || allClassSchedules.length === 0) {
        throw new Error("没有抓取到任何班级课表，快照发布中断");
      }
      const includeReleaseResources = getEnvFlag("SYNC_RELEASE_INCLUDE_RESOURCES", true);
      const snapshot = buildSnapshot(catalog, majors, allClassSchedules, null, {
        resources: {
          includeTeachers: includeReleaseResources,
          includeClassrooms: includeReleaseResources,
          includeCourses: includeReleaseResources,
        },
      });
      const zlib = require("zlib");
      const snapshotJson = JSON.stringify(snapshot, null, 2);
      const snapshotBuffer = Buffer.from(snapshotJson, "utf-8");
      const compressedBuffer = zlib.gzipSync(snapshotBuffer);
      const debugDir = path.join(__dirname, ".debug");
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const normalizeReport = writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer);
      console.log(`\n💾 本地快照已生成并压缩：.debug/snapshot-latest.json 和 .debug/snapshot-latest.json.gz (体积: ${(compressedBuffer.length / 1024).toFixed(2)} KB)`);
      validateLocalReleaseSnapshot(snapshot);
      if (getEnvFlag("SYNC_RELEASE_DRY_RUN", false)) {
        printReleaseSummary(snapshot, { dryRun: true }, { version: snapshot.version }, null);
        const report = {
          success: true,
          dryRun: true,
          version: snapshot.version,
          semester: snapshot.semester,
          updatedAt: snapshot.updatedAt,
          coverage: snapshot.coverage,
          normalizeReport,
          uploadSize: compressedBuffer.length,
        };
        fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
        console.log("ℹ️ SYNC_RELEASE_DRY_RUN=true，已完成本地 release 构建与校验，未上传或激活 VPS。");
        return;
      }
      const uploadRes = await uploadSnapshot(compressedBuffer);
      const activateRes = await activateSnapshot(snapshot.version);
      console.log(`✅ 快照激活成功! 响应: ${JSON.stringify(activateRes)}`);
      const verifyRes = await verifyEndpoints();
      printReleaseSummary(snapshot, uploadRes, activateRes, verifyRes);
      const report = {
        success: true,
        version: snapshot.version,
        semester: snapshot.semester,
        updatedAt: snapshot.updatedAt,
        coverage: snapshot.coverage,
        normalizeReport,
        uploadSize: compressedBuffer.length,
        serverStatus: verifyRes,
      };
      fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
      console.log(`💾 总结报告已保存至 .debug/sync-report-latest.json`);
      console.log("\n🎉 [Release] 全校课表暴力快照发布成功！");
    } else if (action === "all") {
      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      await syncClassSchedules(page, catalog, majors);
      console.log("\n🎉 [同步大成功] 本地所有数据已全量同步至 VPS！");
    } else {
      console.error(`❌ 未知的同步参数: ${action}`);
      console.log("支持的参数: catalog | majors | class | resources | release | fresh | quick | all");
    }

  } catch (error) {
    console.error(`❌ 执行同步时发生致命异常: ${error.message}`);
    console.error(error.stack);
    printPowerShellCommands();
  } finally {
    await browser.close();
    console.log("浏览器已安全关闭。同步任务结束。");
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    selectSemester,
    getCollegeSlug,
    saveMajorResponseSample,
    parseMajorOptionsFromResponse,
    cleanMajorsPayload,
    normalizeMajorItem
  };
}
