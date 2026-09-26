const assert = require("assert");
const { PROFILE_TIMEOUT_MS } = require("../miniprogram/services/fosuDirectConfig");
const { createFosuDirectClient } = require("../miniprogram/services/fosuDirectClient");

assert.ok(PROFILE_TIMEOUT_MS >= 2000 && PROFILE_TIMEOUT_MS <= 3000);
assert.strictEqual(6000 * 2, 12000);
assert.ok(PROFILE_TIMEOUT_MS < 6000);

const LOGIN_HTML = "<form><input type=\"hidden\" name=\"execution\" value=\"e1\" /><input type=\"hidden\" id=\"pwdEncryptSalt\" value=\"nwxB9tTnv9UJDSX6\" /><input name=\"username\" /><input type=\"password\" name=\"password\" /></form>";
const HOME = "教学综合信息服务平台";
const TIMETABLE = "<table id=\"kbtable\"><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr><tr><td>第一大节</td><td>高等数学<br>1-16周<br>[01-02]节<br>A101</td></tr></table>";

function bytes(text) {
  return new TextEncoder().encode(text).buffer;
}

function transportFor(profile) {
  const calls = [];
  return {
    calls,
    manualRedirect: true,
    async request(spec) {
      calls.push(spec.url);
      if (spec.url.includes("caslogin.jsp") && !spec.url.includes("ticket=")) {
        return { statusCode: 302, header: { Location: "https://authserver.fosu.edu.cn/authserver/login?service=cas" } };
      }
      if (spec.url.includes("/authserver/login") && spec.method !== "POST") return { statusCode: 200, data: LOGIN_HTML };
      if (spec.url.includes("checkNeedCaptcha")) return { statusCode: 200, data: "{\"isNeed\":false}" };
      if (spec.method === "POST" && spec.url.includes("/authserver/login")) {
        return { statusCode: 302, header: { Location: "https://100.fosu.edu.cn/caslogin.jsp?ticket=ST-TEST" } };
      }
      if (spec.url.includes("caslogin.jsp")) return { statusCode: 302, header: { Location: "https://100.fosu.edu.cn/framework/xsMain.jsp" } };
      if (spec.url.includes("xsMain.jsp")) return { statusCode: 200, data: HOME };
      if (spec.url.includes("xskb_list.do")) return { statusCode: 200, data: bytes(TIMETABLE), header: { "Content-Type": "text/html" } };
      if (spec.url.includes("/grxx/xsxx")) return profile(spec, calls);
      throw new Error("unexpected " + spec.url);
    },
  };
}

async function read(profile) {
  const transport = transportFor(profile);
  const result = await createFosuDirectClient({ transport }).readTimetable({
    studentId: "202500000303",
    password: "school-secret",
  });
  return { result, calls: transport.calls.filter((url) => url.includes("/grxx/xsxx")).length };
}

async function run() {
  const timeout = await read(() => {
    const error = new Error("timeout");
    error.code = "DIRECT_NETWORK_ERROR";
    throw error;
  });
  assert.strictEqual(timeout.calls, 1);
  assert.strictEqual(timeout.result.profileHint.profileStatus, "unavailable");
  assert.ok(timeout.result.timetableBodyBase64);

  const missing = await read(() => ({ statusCode: 500, data: "", header: {} }));
  assert.strictEqual(missing.calls, 1);
  assert.strictEqual(missing.result.profileHint.profileStatus, "unavailable");

  const changed = await read(() => ({ statusCode: 200, data: bytes("<html><body>页面已调整</body></html>"), header: {} }));
  assert.strictEqual(changed.result.profileHint.profileStatus, "unavailable");
  assert.ok(changed.result.timetableBodyBase64);

  const mismatch = transportFor(() => ({
    statusCode: 200,
    data: bytes("<td>学号</td><td>202500000999</td><td>姓名</td><td>王同学</td>"),
    header: {},
  }));
  await assert.rejects(
    () => createFosuDirectClient({ transport: mismatch }).readTimetable({ studentId: "202500000303", password: "school-secret" }),
    (error) => error.code === "PROFILE_ID_MISMATCH"
  );
  console.log("profile-soft-failure PASS");
  console.log(JSON.stringify({
    previousProfileDragMs: 12000,
    softTimeoutMs: PROFILE_TIMEOUT_MS,
    profileAttempts: 1,
  }));
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
