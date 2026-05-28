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

  notConnected() {
    assertNotConnected();
  }

  async login(studentId, password) {
    void studentId;
    void password;
    // TODO: 用 DevTools 脱敏抓包补充真实登录 URL、Method、Form Data、验证码/二次校验规则和返回结构。
    // 禁止打印 password、Cookie、Token、JSESSIONID；后续只允许写入脱敏日志。
    return this.notConnected();
  }

  async fetchPersonalSchedule(session, params) {
    void session;
    void params;
    // TODO: 将 /xskb/xskb_list.do 的 URL、Method、Query Params、Form Data 和 HTML/JSON 响应样例填到这里。
    return this.notConnected();
  }

  async fetchClassSchedule(session, params) {
    void session;
    void params;
    // TODO: 将 /kbcx/kbxx_xzb 的 URL、Method、Query Params、Form Data 和 HTML/JSON 响应样例填到这里。
    return this.notConnected();
  }

  async fetchTeacherSchedule(session, params) {
    void session;
    void params;
    // TODO: 将 /kbcx/kbxx_teacher 的 URL、Method、Query Params、Form Data 和 HTML/JSON 响应样例填到这里。
    return this.notConnected();
  }

  async fetchClassroomSchedule(session, params) {
    void session;
    void params;
    // TODO: 将 /kbcx/kbxx_classroom 的 URL、Method、Query Params、Form Data 和 HTML/JSON 响应样例填到这里。
    return this.notConnected();
  }

  async fetchCourseSchedule(session, params) {
    void session;
    void params;
    // TODO: 将 /kbcx/kbxx_kc 的 URL、Method、Query Params、Form Data 和 HTML/JSON 响应样例填到这里。
    return this.notConnected();
  }

  async fetchCalendar(session, params) {
    void session;
    void params;
    // TODO: 抓取“教学日历查看”页面后，把真实 path、Method、Form Data 和响应样例填到这里。
    return this.notConnected();
  }

  async fetchScores(session, params) {
    void session;
    void params;
    // TODO: 将 /kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ 的 URL、Method、Query Params、Form Data 和响应样例填到这里。
    return this.notConnected();
  }
}

module.exports = {
  FosuQiangzhiAdapter,
  baseUrl,
  paths,
};
