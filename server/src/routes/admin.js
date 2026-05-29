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

const STORAGE_DIR = path.join(__dirname, "../../storage");
const zlib = require("zlib");

const SNAPSHOTS_DIR = path.join(STORAGE_DIR, "snapshots");
const HISTORY_DIR = path.join(SNAPSHOTS_DIR, "history");

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

/**
 * 校验管理员 Token
 */
function verifyAdminToken(req, res, next) {
  const token = req.headers["x-admin-token"];
  
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
      message: "未授权：无效的管理员 Token",
    });
  }

  next();
}

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
  const meta = getSyncMeta();
  meta[key] = {
    updatedAt: new Date().toISOString(),
    itemCount: dataCount,
    syncSource: syncSource || "local-sync-client",
  };
  try {
    fs.writeFileSync(FILE_MAP["sync-meta"], JSON.stringify(meta, null, 2), "utf-8");
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
  verifyAdminToken,
  createSyncHandler("catalog", (data) => {
    return data && Array.isArray(data.colleges) && Array.isArray(data.semesters) && Array.isArray(data.grades);
  })
);

// 2. 同步 Majors (自定义 handler)
router.post(
  "/sync/majors",
  verifyAdminToken,
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
  verifyAdminToken,
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
  verifyAdminToken,
  createSyncHandler("teacher-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 5. 同步 Classroom Schedules
router.post(
  "/sync/classroom-schedules",
  verifyAdminToken,
  createSyncHandler("classroom-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 6. 同步 Course Schedules
router.post(
  "/sync/course-schedules",
  verifyAdminToken,
  createSyncHandler("course-schedules", (data) => {
    return Array.isArray(data);
  })
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

// 6.5. 上传快照临时文件
router.post(
  "/snapshot/upload",
  verifyAdminToken,
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
  verifyAdminToken,
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
router.get("/sync/status", (req, res) => {
  const meta = getSyncMeta();
  const snapshotMeta = getActiveSnapshotMeta();
  
  res.json({
    success: true,
    dataSourceMode: config.DATA_SOURCE_MODE,
    snapshotUpdatedAt: snapshotMeta ? snapshotMeta.updatedAt : (meta.snapshot ? meta.snapshot.updatedAt : null),
    snapshotVersion: snapshotMeta ? snapshotMeta.version : (meta.snapshot ? meta.snapshot.version : null),
    semester: snapshotMeta ? snapshotMeta.semester : (meta.snapshot ? meta.snapshot.semester : "2025-2026-2"),
    collegesCount: snapshotMeta ? snapshotMeta.collegesCount : getItemCount("catalog"),
    majorsCount: snapshotMeta ? snapshotMeta.majorsCount : getItemCount("majors"),
    classScheduleCount: snapshotMeta ? snapshotMeta.classScheduleCount : getItemCount("class-schedules"),
    adminClassCount: snapshotMeta ? snapshotMeta.adminClassCount : 0,
    majorAggregateCount: snapshotMeta ? snapshotMeta.majorAggregateCount : 0,
    teacherScheduleCount: snapshotMeta ? snapshotMeta.teacherScheduleCount : getItemCount("teacher-schedules"),
    classroomScheduleCount: snapshotMeta ? snapshotMeta.classroomScheduleCount : getItemCount("classroom-schedules"),
    courseScheduleCount: snapshotMeta ? snapshotMeta.courseScheduleCount : getItemCount("course-schedules"),
    catalogUpdatedAt: getUpdatedAt("catalog"),
    classSchedulesUpdatedAt: getUpdatedAt("class-schedules"),
    storageMounted: isStorageMounted(),
    storagePath: STORAGE_DIR,
    metaDetails: meta,
  });
});

// 8. 管理员审核贡献接口
// POST /api/admin/review/contributions
router.post(
  "/review/contributions",
  verifyAdminToken,
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

module.exports = router;
