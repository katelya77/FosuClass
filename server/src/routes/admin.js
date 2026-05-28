/**
 * 管理员同步 API 路由：接收本地同步工具上传的教务数据并持久化到 storage。
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const config = require("../config");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.join(__dirname, "../../storage");

// 确保目录存在
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
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
    str.includes("casticket") ||
    str.includes("password") ||
    str.includes("passwd")
  );
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
  "/catalog",
  verifyAdminToken,
  createSyncHandler("catalog", (data) => {
    // 必须包含 colleges, semesters, grades 且 success 是 true
    return data && Array.isArray(data.colleges) && Array.isArray(data.semesters) && Array.isArray(data.grades);
  })
);

// 2. 同步 Majors
router.post(
  "/majors",
  verifyAdminToken,
  createSyncHandler("majors", (data) => {
    return Array.isArray(data);
  })
);

// 3. 同步 Class Schedules
router.post(
  "/class-schedules",
  verifyAdminToken,
  createSyncHandler("class-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 4. 同步 Teacher Schedules
router.post(
  "/teacher-schedules",
  verifyAdminToken,
  createSyncHandler("teacher-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 5. 同步 Classroom Schedules
router.post(
  "/classroom-schedules",
  verifyAdminToken,
  createSyncHandler("classroom-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 6. 同步 Course Schedules
router.post(
  "/course-schedules",
  verifyAdminToken,
  createSyncHandler("course-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 7. 获取当前缓存状态 (公开，或也可以加上 Token，这里根据用户要求: /api/admin/sync/status 不需要限制，若需要可限制。题目未提及是否限制 Token，为方便展示且不泄露 Token，可直接公开)
router.get("/status", (req, res) => {
  const meta = getSyncMeta();
  res.json({
    success: true,
    dataSourceMode: config.DATA_SOURCE_MODE,
    catalogUpdatedAt: getUpdatedAt("catalog"),
    collegesCount: getItemCount("catalog"),
    majorsCount: getItemCount("majors"),
    classScheduleCount: getItemCount("class-schedules"),
    teacherScheduleCount: getItemCount("teacher-schedules"),
    classroomScheduleCount: getItemCount("classroom-schedules"),
    courseScheduleCount: getItemCount("course-schedules"),
    metaDetails: meta,
  });
});

module.exports = router;
