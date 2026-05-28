/**
 * 全校目录服务：管理全校学院、年级、学期选项及专业联动列表的读取与缓存逻辑。
 * 支持 cache-first 本地缓存静态化模式、realtime 直连调试模式和 disabled 禁用模式。
 */

const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const { FosuQiangzhiAdapter } = require("./fosuQiangzhiAdapter");
const { parseSchoolOptionsHtml, parseMajorAjaxResponse } = require("../utils/parser");
const cache = require("../utils/cache");
const { safeLog } = require("../utils/safeLogger");
const config = require("../config");

const STORAGE_DIR = path.join(__dirname, "../../storage");
const FILE_MAP = {
  catalog: path.join(STORAGE_DIR, "catalog.json"),
  majors: path.join(STORAGE_DIR, "majors-index.json"),
  "sync-meta": path.join(STORAGE_DIR, "sync-meta.json"),
};

/**
 * 安全读取 JSON 文件
 */
function readJsonFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      safeLog("read-json-file-error", { filePath, error: error.message });
      return null;
    }
  }
  return null;
}

/**
 * 获取元数据
 */
function getMeta(key) {
  const metaPath = FILE_MAP["sync-meta"];
  const meta = readJsonFile(metaPath);
  return meta && meta[key] ? meta[key] : {};
}

/**
 * 默认开发环境的 Demo 数据
 */
function getDemoCatalog(semesterParam) {
  return {
    success: true,
    dataSource: "demo",
    updatedAt: new Date().toISOString(),
    semesters: [
      { value: semesterParam, label: `${semesterParam}学年学期 (Demo)` }
    ],
    colleges: [
      { code: "02", name: "物理与光电工程学院 (Demo)", rawLabel: "物理与光电工程学院" },
      { code: "04", name: "动物科技学院 (Demo)", rawLabel: "动物科技学院" }
    ],
    grades: ["2022", "2023", "2024", "2025"],
    weeks: Array.from({ length: 20 }, (_, i) => ({
      value: String(i + 1),
      label: `第${i + 1}周`
    })),
    sections: []
  };
}

/**
 * 默认开发环境的 Demo 专业数据
 */
function getDemoMajors(collegeCode, grade) {
  return [
    { code: "0401", name: "动物科学 (Demo)" },
    { code: "0402", name: "动物医学 (Demo)" }
  ];
}

/**
 * 辅助检查域名是否能解析
 */
async function checkDns(hostname) {
  try {
    await dns.lookup(hostname);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 获取全校目录
 * @param {string} semester 学期，如 "2025-2026-2"
 * @returns {Promise<Object>} 目录数据
 */
async function getCatalog(semester) {
  const semesterParam = semester || "2025-2026-2";
  const mode = config.DATA_SOURCE_MODE;

  // 1. disabled 模式
  if (mode === "disabled") {
    return {
      success: false,
      message: "教务数据查询服务暂时关闭维护中。",
    };
  }

  // 2. realtime 模式（直连强智调试）
  if (mode === "realtime") {
    // 检查能否解析 100.fosu.edu.cn
    const host = new URL(config.FOSU_BASE_URL).hostname;
    const canResolve = await checkDns(host);
    if (!canResolve) {
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: "100.fosu.edu.cn 仅校园网或 EasyConnect VPN 可访问，当前服务器无法直连。",
      };
    }

    try {
      safeLog("catalog-fetch-realtime-debug", { semester: semesterParam });
      const adapter = new FosuQiangzhiAdapter();
      const res = await adapter.fetchClassOptionsPage();
      if (res.statusCode !== 200) {
        throw new Error(`教务网入口页面请求失败，HTTP 状态码: ${res.statusCode}`);
      }

      const parsed = parseSchoolOptionsHtml(res.text);
      const colleges = (parsed.colleges || [])
        .map((item) => {
          const rawLabel = item.name || "";
          const cleanName = rawLabel.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim();
          return { code: item.code, name: cleanName, rawLabel };
        })
        .filter((item) => item.code && item.name && !item.name.includes("请选择"));

      const semesters = (parsed.semesters || [])
        .map((item) => ({ value: item.code, label: item.name }))
        .filter((item) => item.value);

      if (!semesters.some((s) => s.value === semesterParam)) {
        semesters.unshift({ value: semesterParam, label: semesterParam });
      }

      const grades = (parsed.grades || [])
        .map((item) => String(item).trim())
        .filter((item) => item && /^\d{4}$/.test(item) && !item.includes("选择"));

      const weeks = Array.from({ length: 20 }, (_, i) => ({
        value: String(i + 1),
        label: `第${i + 1}周`
      }));

      return {
        success: true,
        dataSource: "fosu-realtime",
        updatedAt: new Date().toISOString(),
        semesters,
        colleges,
        grades,
        weeks,
        sections: [],
      };
    } catch (error) {
      safeLog("catalog-realtime-failed", { error: error.message });
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: `无法实时连接教务系统: ${error.message}，100.fosu.edu.cn 仅校园网或 EasyConnect VPN 可访问。`,
      };
    }
  }

  // 3. cache-first 默认模式
  const catalogData = readJsonFile(FILE_MAP["catalog"]);
  if (catalogData) {
    const meta = getMeta("catalog");
    return {
      success: true,
      dataSource: "cache",
      updatedAt: meta.updatedAt || new Date().toISOString(),
      syncSource: meta.syncSource || "local-sync-client",
      itemCount: meta.itemCount || (catalogData.colleges || []).length,
      semesters: catalogData.semesters || [],
      colleges: catalogData.colleges || [],
      grades: catalogData.grades || [],
      weeks: catalogData.weeks || [],
      sections: catalogData.sections || [],
    };
  }

  // 开发环境降级 Demo
  if (config.NODE_ENV !== "production") {
    return getDemoCatalog(semesterParam);
  }

  // 无同步数据提示
  return {
    success: true,
    dataSource: "empty",
    reasonCode: "NO_SYNC_DATA",
    message: "暂未同步教务数据，请稍后再试。",
  };
}

/**
 * 根据学院和年级获取联动专业列表
 * @param {string} collegeCode 学院代码
 * @param {string} grade 年级
 * @returns {Promise<Object>} 专业列表数据
 */
async function getMajors(collegeCode, grade) {
  if (!collegeCode || !grade) {
    return {
      success: false,
      message: "collegeCode and grade are required",
      majors: []
    };
  }

  const mode = config.DATA_SOURCE_MODE;

  // 1. disabled 模式
  if (mode === "disabled") {
    return {
      success: false,
      message: "教务数据查询服务暂时关闭维护中。",
    };
  }

  // 2. realtime 模式
  if (mode === "realtime") {
    const host = new URL(config.FOSU_BASE_URL).hostname;
    const canResolve = await checkDns(host);
    if (!canResolve) {
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: "100.fosu.edu.cn 仅校园网或 EasyConnect VPN 可访问，当前服务器无法直连。",
      };
    }

    try {
      safeLog("majors-fetch-realtime-debug", { collegeCode, grade });
      const adapter = new FosuQiangzhiAdapter();
      const res = await adapter.fetchMajorOptions({ collegeCode, grade });
      if (res.statusCode !== 200) {
        throw new Error(`教务专业联动接口返回异常，HTTP 状态码: ${res.statusCode}`);
      }

      const parsed = parseMajorAjaxResponse(res.text, { collegeCode, grade });
      const majors = (parsed.majors || [])
        .map((item) => ({ code: item.code, name: item.name }))
        .filter((item) => item.code && item.name && !item.name.includes("请选择"));

      return {
        success: true,
        collegeCode,
        grade,
        majors,
        updatedAt: new Date().toISOString(),
        dataSource: "fosu-realtime",
      };
    } catch (error) {
      safeLog("majors-realtime-failed", { error: error.message });
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: `无法实时连接教务系统专业联动接口: ${error.message}`,
      };
    }
  }

  // 3. cache-first 模式
  const majorsIndex = readJsonFile(FILE_MAP["majors"]);
  if (majorsIndex && Array.isArray(majorsIndex.colleges)) {
    const college = majorsIndex.colleges.find((c) => String(c.collegeCode) === String(collegeCode));
    let filtered = [];
    if (college && Array.isArray(college.grades)) {
      const gradeObj = college.grades.find((g) => String(g.grade) === String(grade));
      if (gradeObj && Array.isArray(gradeObj.majors)) {
        filtered = gradeObj.majors.map((m) => ({
          code: m.majorCode,
          name: m.majorName,
        }));
      }
    }

    const meta = getMeta("majors");
    return {
      success: true,
      collegeCode,
      grade,
      majors: filtered,
      updatedAt: majorsIndex.updatedAt || meta.updatedAt || new Date().toISOString(),
      dataSource: "cache",
      syncSource: meta.syncSource || "local-sync-client",
      itemCount: filtered.length,
    };
  }

  // 开发环境降级 Demo
  if (config.NODE_ENV !== "production") {
    return {
      success: true,
      collegeCode,
      grade,
      majors: getDemoMajors(collegeCode, grade),
      updatedAt: new Date().toISOString(),
      dataSource: "demo",
    };
  }

  return {
    success: true,
    collegeCode,
    grade,
    majors: [],
    dataSource: "empty",
    reasonCode: "NO_SYNC_DATA",
    message: "暂未同步教务专业数据，请稍后再试。",
  };
}

module.exports = {
  getCatalog,
  getMajors,
};
