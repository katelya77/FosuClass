const { assertNotConnected } = require("./safety");

const baseUrl = "https://100.fosu.edu.cn";

const paths = {
  personalSchedulePath: "/xskb/xskb_list.do",
  classSchedulePath: "/kbcx/kbxx_xzb",
  teacherSchedulePath: "/kbcx/kbxx_teacher",
  classroomSchedulePath: "/kbcx/kbxx_classroom",
  courseSchedulePath: "/kbcx/kbxx_kc",
  scorePath: "/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ",
};

class FosuQiangzhiAdapter {
  constructor(options) {
    const config = options || {};
    this.baseUrl = config.baseUrl || baseUrl;
    this.timeout = config.timeout || 8000;
    this.minIntervalMs = config.minIntervalMs || 1200;
  }

  buildUrl(path) {
    return `${this.baseUrl}${path}`;
  }

  async login(studentId, password) {
    if (!studentId || !password) {
      throw new Error("缺少学号或密码。");
    }
    // TODO: 根据脱敏抓包补充真实登录 URL、Method、Form Data、验证码处理方式和返回结构。
    // 不绕过验证码，不保存明文密码，不打印密码、Cookie、Token 或 Session。
    assertNotConnected();
  }

  async fetchPersonalSchedule(session, params) {
    // TODO: 接入 /xskb/xskb_list.do，解析“我的课表 / 学期理论课表”。
    assertNotConnected();
  }

  async fetchClassSchedule(session, params) {
    // TODO: 接入 /kbcx/kbxx_xzb，解析行政班级课表。
    assertNotConnected();
  }

  async fetchTeacherSchedule(session, params) {
    // TODO: 接入 /kbcx/kbxx_teacher，解析教师课表。
    assertNotConnected();
  }

  async fetchClassroomSchedule(session, params) {
    // TODO: 接入 /kbcx/kbxx_classroom，解析教室课表。
    assertNotConnected();
  }

  async fetchCourseSchedule(session, params) {
    // TODO: 接入 /kbcx/kbxx_kc，解析课程课表。
    assertNotConnected();
  }

  async fetchCalendar(session, params) {
    // TODO: 接入后台“教学日历查看”页面。
    assertNotConnected();
  }

  async fetchScores(session, params) {
    // TODO: 接入 /kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ。
    assertNotConnected();
  }
}

module.exports = {
  FosuQiangzhiAdapter,
  baseUrl,
  paths,
};
