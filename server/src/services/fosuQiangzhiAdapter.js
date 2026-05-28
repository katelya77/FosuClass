/**
 * 强智教务网 HTTP 接口适配器：定义教务系统的各个功能 URL 并发送请求，结合 casSession 实现请求重试。
 */

const { URLSearchParams } = require("url");
const { requestWithRetry } = require("./casSession");
const { safeLog } = require("../utils/safeLogger");
const config = require("../config");

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
};

/**
 * 过滤空字段参数
 */
function compactParams(params) {
  const output = {};
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    output[key] = value === undefined || value === null ? "" : value;
  });
  return output;
}

/**
 * 将对象序列化为 x-www-form-urlencoded
 */
function encodeForm(params) {
  return new URLSearchParams(compactParams(params)).toString();
}

/**
 * 拼接 URL query 参数
 */
function buildQuery(path, params) {
  const query = encodeForm(params);
  return query ? `${path}?${query}` : path;
}

class FosuQiangzhiAdapter {
  constructor(options) {
    const opt = options || {};
    this.baseUrl = opt.baseUrl || config.FOSU_BASE_URL;
    this.timeout = opt.timeout || config.REQUEST_TIMEOUT_MS;
  }

  buildUrl(path) {
    return `${this.baseUrl}${path}`;
  }

  /**
   * 发起强智请求，整合 CAS 登录重试机制
   */
  async request(path, options) {
    const opt = options || {};
    const method = opt.method || "GET";
    const body = opt.body || "";
    const url = this.buildUrl(path);

    safeLog("fosu-adapter-request", { method, path, hasBody: Boolean(body) });

    const response = await requestWithRetry(async (client) => {
      const headers = Object.assign(
        {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
          Referer: this.buildUrl(paths.classSchedulePage),
        },
        opt.headers || {}
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

  /**
   * 获取全校 Catalog 页面
   */
  async fetchClassOptionsPage() {
    return this.get(paths.classSchedulePage);
  }

  /**
   * 获取联动专业列表
   */
  async fetchMajorOptions(params) {
    return this.get(paths.majorAjax, {
      skyx: params && params.collegeCode,
      sknj: params && params.grade,
    });
  }

  /**
   * 获取班级课表
   */
  async fetchClassSchedule(params) {
    return this.post(paths.classScheduleIfr, {
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

  /**
   * 获取教师课表
   */
  async fetchTeacherSchedule(params) {
    return this.post(paths.teacherScheduleIfr, {
      xnxqh: (params && params.semester) || "2025-2026-2",
      skyx: params && params.collegeCode,
      jszc: params && params.teacherTitleCode,
      zc1: params && params.weekStart,
      zc2: params && params.weekEnd,
      jc1: params && params.sectionStart,
      jc2: params && params.sectionEnd,
    });
  }

  /**
   * 获取教室课表
   */
  async fetchClassroomSchedule(params) {
    return this.post(paths.classroomScheduleIfr, {
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

  /**
   * 获取课程课表
   */
  async fetchCourseSchedule(params) {
    return this.post(paths.courseScheduleIfr, {
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
}

module.exports = {
  FosuQiangzhiAdapter,
};
