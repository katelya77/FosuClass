/**
 * 全校目录服务：管理全校学院、年级、学期选项及专业联动列表的抓取与缓存逻辑。
 */

const { FosuQiangzhiAdapter } = require("./fosuQiangzhiAdapter");
const { parseSchoolOptionsHtml, parseMajorAjaxResponse } = require("../utils/parser");
const cache = require("../utils/cache");
const { safeLog } = require("../utils/safeLogger");

/**
 * 默认的全校选项，作为降级备用数据
 */
function getDefaultCatalog(semesterParam) {
  return {
    success: true,
    dataSource: "fallback-mock",
    updatedAt: new Date().toISOString(),
    semesters: [
      { value: semesterParam, label: `${semesterParam}学年学期` }
    ],
    colleges: [
      { code: "02", name: "物理与光电工程学院", rawLabel: "物理与光电工程学院" },
      { code: "04", name: "动物科技学院", rawLabel: "动物科技学院" }
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
 * 获取全校目录
 * @param {string} semester 学期，如 "2025-2026-2"
 * @returns {Promise<Object>} 目录数据
 */
async function getCatalog(semester) {
  const semesterParam = semester || "2025-2026-2";
  const cacheKey = cache.keys.getCatalogKey(semesterParam);

  // 1. 尝试从短期内存缓存中获取
  const cached = cache.get(cacheKey);
  if (cached) {
    safeLog("catalog-hit-cache", { semester: semesterParam });
    return cached;
  }

  try {
    safeLog("catalog-fetch-realtime", { semester: semesterParam });
    const adapter = new FosuQiangzhiAdapter();
    
    // 2. 实时拉取教务行政班级入口页
    const res = await adapter.fetchClassOptionsPage();
    if (res.statusCode !== 200) {
      throw new Error(`教务网入口页面请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    // 3. 解析选项 HTML
    const parsed = parseSchoolOptionsHtml(res.text);
    
    // 4. 清洗和组装数据
    const colleges = (parsed.colleges || [])
      .map((item) => {
        const rawLabel = item.name || "";
        const cleanName = rawLabel.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim(); // 去除 [04] 这种前缀
        return {
          code: item.code,
          name: cleanName,
          rawLabel: rawLabel,
        };
      })
      .filter((item) => item.code && item.name && !item.name.includes("请选择"));

    const semesters = (parsed.semesters || [])
      .map((item) => ({
        value: item.code,
        label: item.name,
      }))
      .filter((item) => item.value);

    // 如果接口解析不到学期，补充当前所选学期作为默认值
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

    const catalogData = {
      success: true,
      dataSource: "fosu-realtime",
      updatedAt: new Date().toISOString(),
      semesters,
      colleges,
      grades,
      weeks,
      sections: [],
    };

    // 5. 保存到短期缓存
    cache.set(cacheKey, catalogData, cache.TTL.CATALOG);

    return catalogData;
  } catch (error) {
    safeLog("catalog-fetch-failed", { error: error.message });
    
    // 容灾处理：如果网络请求挂了，我们从 Mock 数据降级读取并增加 warning
    const fallback = getDefaultCatalog(semesterParam);
    fallback.warning = `无法实时连接教务系统，已使用离线备用选项。原因：${error.message}`;
    return fallback;
  }
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

  const cacheKey = cache.keys.getMajorsKey(collegeCode, grade);

  // 1. 尝试从短期内存缓存中获取
  const cached = cache.get(cacheKey);
  if (cached) {
    safeLog("majors-hit-cache", { collegeCode, grade });
    return {
      success: true,
      collegeCode,
      grade,
      majors: cached,
      updatedAt: new Date().toISOString(),
      dataSource: "cache"
    };
  }

  try {
    safeLog("majors-fetch-realtime", { collegeCode, grade });
    const adapter = new FosuQiangzhiAdapter();
    
    // 2. 实时请求教务 Ajax 专业联动接口
    const res = await adapter.fetchMajorOptions({ collegeCode, grade });
    if (res.statusCode !== 200) {
      throw new Error(`教务专业联动接口返回异常，HTTP 状态码: ${res.statusCode}`);
    }

    // 3. 解析 JSON-like 响应
    const parsed = parseMajorAjaxResponse(res.text, { collegeCode, grade });
    
    // 4. 清理和转换格式
    const majors = (parsed.majors || [])
      .map((item) => ({
        code: item.code,
        name: item.name,
      }))
      .filter((item) => item.code && item.name && !item.name.includes("请选择"));

    // 5. 存入短期缓存
    cache.set(cacheKey, majors, cache.TTL.MAJOR);

    return {
      success: true,
      collegeCode,
      grade,
      majors,
      updatedAt: new Date().toISOString(),
      dataSource: "fosu-realtime",
    };
  } catch (error) {
    safeLog("majors-fetch-failed", { error: error.message });
    
    // 容灾处理：如果网络挂了，返回空列表并提示
    return {
      success: false,
      message: `获取专业联动数据失败: ${error.message}`,
      collegeCode,
      grade,
      majors: [],
      errorType: "FOSU_REQUEST_FAILED",
    };
  }
}

module.exports = {
  getCatalog,
  getMajors,
};
