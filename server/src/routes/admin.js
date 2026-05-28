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

// 3. 同步 Class Schedules
router.post(
  "/sync/class-schedules",
  verifyAdminToken,
  createSyncHandler("class-schedules", (data) => {
    return Array.isArray(data);
  })
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

// 7. 获取当前缓存状态
router.get("/sync/status", (req, res) => {
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
