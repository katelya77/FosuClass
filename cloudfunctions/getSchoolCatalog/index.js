const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { parseSchoolOptionsHtml } = require("../common/parser");
const { getSchoolOptions, saveSchoolOptions } = require("../common/cache");
const { safeLog } = require("../common/safeLogger");
const { normalizeTerm } = require("../common/term");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const semesterParam = normalizeTerm(event && (event.term || event.semester));
  
  try {
    // 1. 尝试从短期内存缓存中获取选项
    const cached = getSchoolOptions(semesterParam);
    
    // 如果缓存是来自实时的且在 10 分钟内 (cache.js 会自动做 TTL 检测，若过期会返回备用/默认 Mock 数据)
    // 但此处我们需要严格控制：如果是实时抓取来的并且在 10 分钟 TTL 范围内，可以直接使用。
    // 如果过期了，或者是备用 Mock 数据，我们尝试去学校教务网拉取最新数据。
    // 为了保险起见，我们看缓存数据的 updatedAt，如果它是不久前更新的，并且 dataSource === "fosu-realtime"，则直接返回。
    if (cached && cached.dataSource === "fosu-realtime") {
      safeLog("catalog-hit-cache", { semester: semesterParam });
      return cached;
    }

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
    // 学院 skyx options 格式通常为: [{ code: "04", name: "[04]动物科技学院" }]
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

    // 学期 xnxqh options 格式通常为: [{ code: "YYYY-YYYY-1/2", name: "YYYY-YYYY-1/2" }]
    const semesters = (parsed.semesters || [])
      .map((item) => ({
        value: item.code,
        label: item.name,
      }))
      .filter((item) => item.value);

    // 如果接口解析不到学期，补充调用方明确选择的学期。
    if (semesterParam && !semesters.some((s) => s.value === semesterParam)) {
      semesters.unshift({ value: semesterParam, label: semesterParam });
    }

    // 年级 sknj options
    const grades = (parsed.grades || [])
      .map((item) => String(item).trim())
      .filter((item) => item && /^\d{4}$/.test(item) && !item.includes("选择"));

    // 默认周次 (1-20周)
    const weeks = [];
    for (let i = 1; i <= 20; i++) {
      weeks.push({
        value: String(i),
        label: `第${i}周`,
      });
    }

    const catalogData = {
      success: true,
      dataSource: "fosu-realtime",
      updatedAt: new Date().toISOString(),
      semesters,
      colleges,
      grades,
      weeks,
      sections: [], // 节次一般是动态加载或固定
    };

    // 5. 保存到短期缓存
    saveSchoolOptions(catalogData, semesterParam);

    return catalogData;
  } catch (error) {
    safeLog("catalog-fetch-failed", { error: error.message });
    
    // 容灾处理：如果网络请求挂了，我们从缓存或 mock 降级读取
    const fallback = getSchoolOptions(semesterParam);
    return Object.assign({}, fallback, {
      success: true,
      dataSource: "fallback-mock",
      updatedAt: new Date().toISOString(),
      warning: `无法实时连接教务系统，已使用离线数据。原因：${error.message}`,
    });
  }
};
