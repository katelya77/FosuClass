const https = require("https");
const { URLSearchParams } = require("url");
const { safeLog } = require("./safeLogger");

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

function normalizeSession(session) {
  const safeSession = session || {};
  return {
    cookie: safeSession.cookie || safeSession.Cookie || "",
    headers: safeSession.headers || {},
  };
}

class FosuQiangzhiAdapter {
  constructor(options) {
    const config = options || {};
    this.baseUrl = config.baseUrl || baseUrl;
    this.timeout = config.timeout || 10000;
    this.minIntervalMs = config.minIntervalMs || 1200;
    this.enableNetwork = config.enableNetwork === true || process.env.FOSU_QZ_ENABLE_NETWORK === "true";
  }

  buildUrl(path) {
    return `${this.baseUrl}${path}`;
  }

  ensureNetworkEnabled() {
    if (!this.enableNetwork) {
      throw new Error("真实教务接口请求默认关闭；确认限流和登录态后，将 enableNetwork 显式设为 true。");
    }
  }

  async request(path, options) {
    this.ensureNetworkEnabled();
    const config = options || {};
    const session = normalizeSession(config.session);
    const method = config.method || "GET";
    const body = config.body || "";
    const url = this.buildUrl(path);

    const headers = Object.assign(
      {
        "User-Agent": "FosuClassCloudFunction/1.0",
        Accept: "text/html,application/json,*/*",
      },
      session.headers,
      config.headers || {}
    );
    if (session.cookie) {
      headers.Cookie = session.cookie;
    }
    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    safeLog("fosu-qz-request", { method, path, params: config.params || {}, hasBody: Boolean(body) });

    return new Promise((resolve, reject) => {
      const req = https.request(url, { method, headers, timeout: this.timeout }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            text,
          });
        });
      });
      req.on("timeout", () => {
        req.destroy(new Error(`教务接口请求超时：${path}`));
      });
      req.on("error", reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  get(session, path, params) {
    return this.request(buildQuery(path, params), {
      method: "GET",
      session,
      params,
    });
  }

  post(session, path, params) {
    return this.request(path, {
      method: "POST",
      session,
      body: encodeForm(params),
      params,
    });
  }

  async login(studentId, password) {
    void studentId;
    void password;
    throw new Error("登录流程尚未接入。后续只能在云函数单次请求周期内临时使用密码，不落库、不写日志。");
  }

  async fetchPersonalSchedule(session, params) {
    const form = compactParams({
      cj0701id: "",
      zc: params && params.week ? params.week : "",
      demo: "",
      xnxq01id: (params && params.semester) || "2025-2026-2",
      sfFD: "1",
      sfBZ: "1",
    });
    return this.post(session, paths.personalSchedule, form);
  }

  async fetchClassOptionsPage(session) {
    return this.get(session, paths.classSchedulePage);
  }

  async fetchMajorOptions(session, params) {
    return this.get(session, paths.majorAjax, {
      skyx: params && params.collegeCode,
      sknj: params && params.grade,
    });
  }

  async fetchClassSchedule(session, params) {
    return this.post(session, paths.classScheduleIfr, {
      xnxqh: (params && params.semester) || "2025-2026-2",
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
    return this.post(session, paths.teacherScheduleIfr, {
      xnxqh: (params && params.semester) || "2025-2026-2",
      skyx: params && params.collegeCode,
      jszc: params && params.teacherTitleCode,
      zc1: params && params.weekStart,
      zc2: params && params.weekEnd,
      jc1: params && params.sectionStart,
      jc2: params && params.sectionEnd,
    });
  }

  async fetchClassroomSchedule(session, params) {
    return this.post(session, paths.classroomScheduleIfr, {
      xnxqh: (params && params.semester) || "2025-2026-2",
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
    return this.post(session, paths.courseScheduleIfr, {
      xnxqh: (params && params.semester) || "2025-2026-2",
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
    return this.get(session, paths.initJc, {
      xnxq: (params && params.semester) || "2025-2026-2",
    });
  }
}

module.exports = {
  FosuQiangzhiAdapter,
  baseUrl,
  paths,
};
