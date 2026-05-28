const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { parseMajorAjaxResponse } = require("../common/parser");
const { getMajorsByCollegeCache, saveMajorsByCollegeCache } = require("../common/cache");
const { safeLog } = require("../common/safeLogger");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const { collegeCode, grade } = event;
  
  if (!collegeCode) {
    return {
      success: false,
      message: "collegeCode is required",
    };
  }

  try {
    // 1. 尝试从 30分钟 缓存中获取
    const cached = getMajorsByCollegeCache(collegeCode, grade);
    if (cached) {
      safeLog("majors-hit-cache", { collegeCode, grade });
      return {
        success: true,
        collegeCode,
        grade,
        majors: cached,
        updatedAt: new Date().toISOString(),
        dataSource: "cache",
      };
    }

    safeLog("majors-fetch-realtime", { collegeCode, grade });
    const adapter = new FosuQiangzhiAdapter();
    
    // 2. 实时请求教务 Ajax 专业联动接口
    const res = await adapter.fetchMajorOptions(null, { collegeCode, grade });
    
    if (res.statusCode !== 200) {
      throw new Error(`教务专业联动接口返回异常，HTTP 状态码: ${res.statusCode}`);
    }

    // 3. 解析 JSON-like HTML 响应
    const parsed = parseMajorAjaxResponse(res.text, { collegeCode, grade });
    
    // 4. 清理、脱敏和转换格式
    const majors = (parsed.majors || [])
      .map((item) => ({
        code: item.code,
        name: item.name,
      }))
      .filter((item) => item.code && item.name && !item.name.includes("请选择"));

    // 5. 存入 30分钟 短期缓存
    saveMajorsByCollegeCache(collegeCode, grade, majors);

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
    return {
      success: false,
      message: `获取专业联动数据失败: ${error.message}`,
      collegeCode,
      grade,
      majors: [],
      errorType: "FOSU_REQUEST_FAILED",
    };
  }
};
