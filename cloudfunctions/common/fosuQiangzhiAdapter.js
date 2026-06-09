const { URLSearchParams } = require("url");
const { requestWithRetry } = require("./casSession");
const { safeLog } = require("./safeLogger");
const { resolveTerm } = require("./term");

const baseUrl = "https://100.fosu.edu.cn";

const paths = {
  personalSchedule: "/xskb/xskb_list.do",
  classSchedulePage: "/kbcx/kbxx_xzb",
  classScheduleIfr: "/kbcx/kbxx_xzb_ifr",
  majorAjax: "/kbcx/getZyByAjax",
  teacherSchedulePage: "/kbcx/kbxx_teacher",
  teacherScheduleIfr: "/kbcx/kbxx_teacher_ifr",
  classroomSchedulePage: "/kbcx/kbxx_classroom",
  classroomScheduleIfr: "/kbcx/kbxx_classroom_ifr",
  courseSchedulePage: "/kbcx/kbxx_kc",
  courseScheduleIfr: "/kbcx/kbxx_kc_ifr",
  initJc: "/kbxx/initJc",
  scorePath: "/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ",
};

function compactParams(params) {
  const output = {};
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    output[key] = value === undefined || value === null ? "" : value;
  });
  return output;
}

function encodeForm(params) {
  return new URLSearchParams(compactParams(params)).toString();
}

function buildQuery(path, params) {
  const query = encodeForm(params);
  return query ? `${path}?${query}` : path;
}

class FosuQiangzhiAdapter {
  constructor(options) {
    const config = options || {};
    this.baseUrl = config.baseUrl || baseUrl;
    this.timeout = config.timeout || 12000;
  }

  buildUrl(path) {
    return `${this.baseUrl}${path}`;
  }

  async request(path, options) {
    const config = options || {};
    const method = config.method || "GET";
    const body = config.body || "";
    const url = this.buildUrl(path);

    safeLog("fosu-adapter-request", { method, path, hasBody: Boolean(body) });

    const response = await requestWithRetry(async (client) => {
      const headers = Object.assign(
        {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
          Referer: this.buildUrl(paths.classSchedulePage),
        },
        config.headers || {}
      );
      if (body) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }

      const res = await client({
        url,
        method,
        headers,
        data: body || undefined,
        timeout: this.timeout,
      });

      return res;
    });

    return {
      statusCode: response.status,
      headers: response.headers,
      text: response.data, // 已经是解码好的字符串
    };
  }

  get(path, params) {
    return this.request(buildQuery(path, params), {
      method: "GET",
      params,
    });
  }

  post(path, params) {
    return this.request(path, {
      method: "POST",
      body: encodeForm(params),
      params,
    });
  }

  // 兼容老代码的 session 占位入参，忽略 session 并走内建安全 CAS 会话
  async fetchPersonalSchedule(session, params) {
    const semester = resolveTerm(params);
    const form = compactParams({
      cj0701id: "",
      zc: params && params.week ? params.week : "",
      demo: "",
      xnxq01id: semester,
      sfFD: "1",
      sfBZ: "1",
    });
    return this.post(paths.personalSchedule, form);
  }

  async fetchClassOptionsPage(session) {
    return this.get(paths.classSchedulePage);
  }

  async fetchMajorOptions(session, params) {
    return this.get(paths.majorAjax, {
      skyx: params && params.collegeCode,
      sknj: params && params.grade,
    });
  }

  async fetchClassSchedule(session, params) {
    const semester = resolveTerm(params);
    return this.post(paths.classScheduleIfr, {
      xnxqh: semester,
      skyx: params && params.collegeCode,
      sknj: params && params.grade,
      skzy: params && params.majorCode,
      zc1: params && params.weekStart,
      zc2: params && params.weekEnd,
      jc1: params && params.sectionStart,
      jc2: params && params.sectionEnd,
    });
  }

  async fetchTeacherSchedule(session, params) {
    const semester = resolveTerm(params);
    return this.post(paths.teacherScheduleIfr, {
      xnxqh: semester,
      skyx: params && params.collegeCode,
      jszc: params && params.teacherTitleCode,
      zc1: params && params.weekStart,
      zc2: params && params.weekEnd,
      jc1: params && params.sectionStart,
      jc2: params && params.sectionEnd,
    });
  }

  async fetchClassroomSchedule(session, params) {
    const semester = resolveTerm(params);
    return this.post(paths.classroomScheduleIfr, {
      xnxqh: semester,
      skyx: params && params.collegeCode,
      xqid: params && params.campusId,
      jzwid: params && params.buildingId,
      zc1: params && params.weekStart,
      zc2: params && params.weekEnd,
      jc1: params && params.sectionStart,
      jc2: params && params.sectionEnd,
    });
  }

  async fetchCourseSchedule(session, params) {
    const semester = resolveTerm(params);
    return this.post(paths.courseScheduleIfr, {
      xnxqh: semester,
      skyx: params && params.collegeCode,
      kkyx: params && params.openCollegeCode,
      zzdKcSX: params && params.courseAttr,
      kc: params && params.courseName,
      zc1: params && params.weekStart,
      zc2: params && params.weekEnd,
      jc1: params && params.sectionStart,
      jc2: params && params.sectionEnd,
    });
  }

  async fetchInitJc(session, params) {
    const semester = resolveTerm(params);
    return this.get(paths.initJc, {
      xnxq: semester,
    });
  }
}

module.exports = {
  FosuQiangzhiAdapter,
  baseUrl,
  paths,
};
