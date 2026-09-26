const assert = require("assert");
const { classifyTimetableDocument } = require("../miniprogram/services/fosuDirectHtml");
const { classifyTimetableDocument: classifyOnServer } = require("../server/src/services/personalSchedulePageAssertion");
const { presentPersonalSyncError } = require("../miniprogram/services/personalSyncErrorPresenter");
const { assertPersonalSyncRenderableState } = require("../miniprogram/services/personalSyncRenderableState");
const { applyPersonalSyncFailure } = require("../miniprogram/services/personalSyncFailureTransition");
const { createFosuDirectClient } = require("../miniprogram/services/fosuDirectClient");

const LOGIN = "<form id='pwdFrom'><input name='username'><input type='password' name='password'></form>";
const AUTH_URL = "https://authserver.fosu.edu.cn/authserver/login";
const EMPTY = "<table id='kbtable'><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr><tr><td>第一大节</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>";
const CHANGED = "<html><body><h1>页面已调整</h1><table><tr><td>公告</td></tr></table></body></html>";
const TIMETABLE = "<table id='kbtable'><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr><tr><td>第一大节</td><td>高等数学<br>1-16周<br>[01-02]节<br>A101</td></tr></table>";

function same(html, url) {
  assert.strictEqual(classifyTimetableDocument(html, url), classifyOnServer(html, url));
  return classifyTimetableDocument(html, url);
}

assert.strictEqual(same(LOGIN, "https://100.fosu.edu.cn/xskb/xskb_list.do"), "INVALID_CREDENTIALS");
assert.strictEqual(same("<html>密码错误</html>", AUTH_URL), "INVALID_CREDENTIALS");
assert.strictEqual(same("<html>用户名或密码不正确</html>", "https://100.fosu.edu.cn/xskb/xskb_list.do"), "INVALID_CREDENTIALS");
assert.strictEqual(same(EMPTY, "https://100.fosu.edu.cn/xskb/xskb_list.do"), "AUTHENTICATED_TIMETABLE");
assert.strictEqual(same(CHANGED, "https://100.fosu.edu.cn/xskb/xskb_list.do"), "STRUCTURE_CHANGED");
assert.strictEqual(same(TIMETABLE, "https://100.fosu.edu.cn/xskb/xskb_list.do"), "AUTHENTICATED_TIMETABLE");

const cases = {
  INVALID_CREDENTIALS: ["学号或密码错误", "学校账号验证未通过，请检查学号和密码后重新尝试。", "重新输入"],
  CAMPUS_SYNC_DAILY_LIMIT: ["今日同步次数已用完", "3", "我知道了"],
  CAMPUS_SYNC_RATE_LIMITED: ["操作有些频繁", "45 秒后", "我知道了"],
  CAMPUS_SYNC_CONCURRENT_LIMIT: ["正在同步课表", "当前已有一次个人课表同步正在进行", "我知道了"],
  CAMPUS_SYNC_BUSY: ["当前同步人数较多", "当前同步任务较多", "我知道了"],
  CAMPUS_SYNC_MAINTENANCE: ["同步服务维护中", "已保存的课表仍可正常使用", "我知道了"],
  AGENT_OFFLINE: ["校内同步节点暂不可用", "暂时无法连接学校系统", "我知道了"],
  TIMEOUT: ["学校系统响应较慢", "学校系统暂时没有正常响应", "我知道了"],
  SCHOOL_UNAVAILABLE: ["学校系统响应较慢", "学校系统暂时没有正常响应", "我知道了"],
  PROFILE_ID_MISMATCH: ["账号身份校验未通过", "读取到的学校账号身份与当前输入不一致", "重新输入"],
  STRUCTURE_CHANGED: ["暂时无法识别课表", "本次没有修改你的现有课表", "我知道了"],
  EMPTY_PERSONAL_SCHEDULE: ["暂未读取到课程", "你的现有课表不会被修改", "我知道了"],
  UNKNOWN_SYNC_ERROR: ["同步没有完成", "问题编号：", "我知道了"],
};

Object.keys(cases).forEach((code) => {
  const extra = code === "CAMPUS_SYNC_DAILY_LIMIT"
    ? { dailyLimit: 3, resetAt: "2026-09-27T00:00:00.000Z" }
    : code === "CAMPUS_SYNC_RATE_LIMITED"
      ? { retryAfterSeconds: 45 }
      : code === "UNKNOWN_SYNC_ERROR"
        ? { requestId: "ab12cd34" }
        : {};
  const view = presentPersonalSyncError(Object.assign({ code: code }, extra));
  cases[code].forEach((needle) => assert.ok(view.title.includes(needle) || view.content.includes(needle) || view.confirmText === needle, code + " missing " + needle));
  assert.ok(!view.title.includes(code) && !view.content.includes(code), code);
  assert.ok(!/HTTP status|CAS response|password|openid/i.test(view.title + view.content), code);
});

const daily = presentPersonalSyncError({ code: "CAMPUS_SYNC_DAILY_LIMIT", dailyLimit: 3, resetAt: "2026-09-26T16:00:00.000Z" });
assert.ok(daily.content.includes("2026-09-27 00:00"));
assert.ok(daily.content.includes("北京时间"));
const rate = presentPersonalSyncError({ code: "CAMPUS_SYNC_RATE_LIMITED" });
assert.ok(rate.content.includes("请稍后再试"));
assert.ok(!rate.content.includes("429"));
const mismatch = presentPersonalSyncError({ code: "PROFILE_ID_MISMATCH", payload: { studentId: "202500009999", studentName: "不应出现" } });
assert.ok(!mismatch.content.includes("202500009999"));
assert.ok(!mismatch.content.includes("不应出现"));

assert.strictEqual(assertPersonalSyncRenderableState({ activeImportMethod: "method", studentImportStage: "form", studentImportLoading: false }).ok, true);
assert.strictEqual(assertPersonalSyncRenderableState({ activeImportMethod: "student", studentImportStage: "loading", studentImportLoading: true }).ok, true);
assert.strictEqual(assertPersonalSyncRenderableState({ activeImportMethod: "student", studentImportStage: "preview", studentImportLoading: false, studentPreviewResult: { courses: [1] } }).ok, true);
assert.strictEqual(assertPersonalSyncRenderableState({ activeImportMethod: "student", studentImportStage: "identity-confirm", studentImportLoading: false, studentPreviewResult: {} }).ok, true);
assert.strictEqual(assertPersonalSyncRenderableState({ activeImportMethod: "student", studentImportStage: "done", studentImportLoading: false }).ok, true);
assert.strictEqual(assertPersonalSyncRenderableState({ activeImportMethod: "method", studentImportLoading: false, syncErrorTitle: "学号或密码错误" }).ok, true);
assert.strictEqual(assertPersonalSyncRenderableState({ activeImportMethod: "student", studentImportStage: "preview", studentImportLoading: false, studentPreviewResult: null }).ok, false);

const invalidSaved = applyPersonalSyncFailure({ code: "INVALID_CREDENTIALS" }, { usingSavedPassword: true, password: "saved-secret", studentId: "202500000001" });
assert.strictEqual(invalidSaved.credentialPatch.clearSavedPassword, true);
assert.strictEqual(invalidSaved.credentialPatch.saveCredential, false);
assert.strictEqual(invalidSaved.patch.studentImportLoading, false);
assert.strictEqual(invalidSaved.patch.activeImportMethod, "method");
assert.ok(!JSON.stringify(invalidSaved.patch).includes("saved-secret"));
assert.strictEqual(invalidSaved.renderable.ok, true);

const manualWrong = applyPersonalSyncFailure({ code: "INVALID_CREDENTIALS" }, { usingSavedPassword: false, password: "typed-secret", studentId: "202500000001" });
assert.strictEqual(manualWrong.credentialPatch.clearSavedPassword, false);
assert.strictEqual(manualWrong.credentialPatch.saveCredential, false);

const empty = applyPersonalSyncFailure({ code: "EMPTY_PERSONAL_SCHEDULE" }, { password: "ok-secret", studentId: "202500000001" });
assert.strictEqual(empty.credentialPatch.saveCredential, true);
assert.strictEqual(empty.view.code, "EMPTY_PERSONAL_SCHEDULE");
assert.notStrictEqual(empty.view.title, "学号或密码错误");

function scripted(pages) {
  return {
    manualRedirect: true,
    async request(spec) {
      const page = pages.find((item) => item.match(spec));
      assert.ok(page, spec.method + " " + spec.url);
      return page.respond(spec);
    },
  };
}

const loginHandlers = [
  { match: (spec) => spec.url.includes("caslogin.jsp") && !spec.url.includes("ticket="), respond: () => ({ statusCode: 302, header: { Location: "https://authserver.fosu.edu.cn/authserver/login?service=cas" } }) },
  { match: (spec) => spec.url.includes("/authserver/login") && spec.method !== "POST", respond: () => ({ statusCode: 200, data: "<input name='execution' value='e1'><input id='pwdEncryptSalt' value='nwxB9tTnv9UJDSX6'><input name='username'><input name='password'>" }) },
  { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":false}" }) },
  { match: (spec) => spec.method === "POST" && spec.url.includes("/authserver/login"), respond: () => ({ statusCode: 200, data: LOGIN }) },
];

createFosuDirectClient({ transport: scripted(loginHandlers) }).readTimetable({ studentId: "202500000001", password: "wrong-secret" })
  .then(() => { throw new Error("login page must not become a timetable"); })
  .catch((error) => {
    assert.strictEqual(error.code, "INVALID_CREDENTIALS");
    return createFosuDirectClient({ transport: scripted([
      { match: (spec) => spec.url.includes("caslogin.jsp") && !spec.url.includes("ticket="), respond: () => ({ statusCode: 302, header: { Location: "https://authserver.fosu.edu.cn/authserver/login?service=cas" } }) },
      { match: (spec) => spec.url.includes("/authserver/login") && spec.method !== "POST", respond: () => ({ statusCode: 200, data: "<input name='execution' value='e1'><input id='pwdEncryptSalt' value='nwxB9tTnv9UJDSX6'><input name='username'><input name='password'>" }) },
      { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":false}" }) },
      { match: (spec) => spec.method === "POST" && spec.url.includes("/authserver/login"), respond: () => ({ statusCode: 302, header: { Location: "https://100.fosu.edu.cn/caslogin.jsp?ticket=ST-TEST" } }) },
      { match: (spec) => spec.url.includes("caslogin.jsp"), respond: () => ({ statusCode: 302, header: { Location: "https://100.fosu.edu.cn/framework/xsMain.jsp" } }) },
      { match: (spec) => spec.url.includes("xsMain.jsp"), respond: () => ({ statusCode: 200, data: "教学综合信息服务平台" }) },
      { match: (spec) => spec.url.includes("xskb_list.do"), respond: () => ({ statusCode: 200, data: LOGIN }) },
    ]) }).readTimetable({ studentId: "202500000001", password: "wrong-secret" });
  })
  .then(() => { throw new Error("http 200 login page must not parse as an empty timetable"); })
  .catch((error) => {
    if (error && error.message && error.message.includes("must not")) throw error;
    assert.strictEqual(error.code, "INVALID_CREDENTIALS");
    console.log("personal sync error contract PASS");
  });
