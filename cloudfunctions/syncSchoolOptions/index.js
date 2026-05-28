const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { getSchoolOptions, saveSchoolOptions } = require("../common/cache");
const { parseMajorAjaxResponse, parseSchoolOptionsHtml } = require("../common/parser");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const payload = event || {};
  const adapter = new FosuQiangzhiAdapter({
    enableNetwork: payload.enableNetwork === true,
  });

  if (!payload.enableNetwork) {
    return {
      success: true,
      source: "local-cache",
      options: getSchoolOptions(),
      message: "当前返回本地缓存的学校筛选元数据；真实同步需在云函数中显式启用网络并配置登录态。",
    };
  }

  const pageResponse = await adapter.fetchClassOptionsPage(payload.session);
  const parsed = parseSchoolOptionsHtml(pageResponse.text);
  let majors = [];
  let warnings = parsed.warnings || [];

  if (payload.collegeCode && payload.grade) {
    const majorResponse = await adapter.fetchMajorOptions(payload.session, {
      collegeCode: payload.collegeCode,
      grade: payload.grade,
    });
    const majorParsed = parseMajorAjaxResponse(majorResponse.text, {
      collegeCode: payload.collegeCode,
      grade: payload.grade,
    });
    majors = majorParsed.majors;
    warnings = warnings.concat(majorParsed.warnings || []);
  }

  const options = saveSchoolOptions(Object.assign({}, getSchoolOptions(), {
    semesters: parsed.semesters.length ? parsed.semesters : getSchoolOptions().semesters,
    colleges: parsed.colleges.length ? parsed.colleges : getSchoolOptions().colleges,
    grades: parsed.grades.length ? parsed.grades : getSchoolOptions().grades,
    majors: majors.length ? majors : getSchoolOptions().majors,
  }));

  return {
    success: true,
    source: "fosu-qz",
    options,
    warnings,
    meta: parsed.meta,
  };
};
