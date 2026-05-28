/**
 * 用户贡献课表路由：普通用户上传或导入个人/班级课表。
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.join(__dirname, "../../storage");
const CONTRIBUTIONS_PATH = path.join(STORAGE_DIR, "contributions.json");

// 确保目录存在
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * 校验上传的敏感字段
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

// POST /api/contribute/schedule
router.post("/schedule", (req, res) => {
  const {
    className,
    collegeCode,
    collegeName,
    majorCode,
    majorName,
    grade,
    semester,
    courses,
  } = req.body;

  // 基础校验
  if (!className || !collegeName || !majorName || !grade || !semester || !Array.isArray(courses)) {
    return res.status(400).json({
      success: false,
      message: "缺少必要参数或 courses 格式不正确",
    });
  }

  // 敏感字段校验
  if (containsSensitiveData(req.body)) {
    safeLog("contribute-blocked-sensitive", { className });
    return res.status(400).json({
      success: false,
      message: "贡献的数据中包含敏感字段（如 Cookie/密码），拒绝接收",
    });
  }

  try {
    let contributions = [];
    if (fs.existsSync(CONTRIBUTIONS_PATH)) {
      try {
        contributions = JSON.parse(fs.readFileSync(CONTRIBUTIONS_PATH, "utf-8"));
      } catch (err) {
        safeLog("read-contributions-failed", { error: err.message });
      }
    }

    // 生成唯一贡献 ID
    const newContrib = {
      id: `contrib_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      className: String(className).trim(),
      collegeCode: collegeCode ? String(collegeCode).trim() : "",
      collegeName: String(collegeName).trim(),
      majorCode: majorCode ? String(majorCode).trim() : "",
      majorName: String(majorName).trim(),
      grade: String(grade).trim(),
      semester: String(semester).trim(),
      courses: courses, // 课程数组
      sourceType: "user-import",
      reviewed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    contributions.push(newContrib);
    fs.writeFileSync(CONTRIBUTIONS_PATH, JSON.stringify(contributions, null, 2), "utf-8");

    safeLog("user-contribute-success", { className, id: newContrib.id });

    return res.json({
      success: true,
      message: "课表已成功提交，待管理员审核通过后将合并进公共课表",
      contributionId: newContrib.id,
    });
  } catch (error) {
    safeLog("user-contribute-failed", { error: error.message });
    return res.status(500).json({
      success: false,
      message: `保存贡献课表失败: ${error.message}`,
    });
  }
});

module.exports = router;
