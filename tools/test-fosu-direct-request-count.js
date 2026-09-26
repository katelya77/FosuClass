const assert = require("assert");
const { createCookieJar } = require("../miniprogram/services/fosuDirectCookieJar");
const { createFosuDirectClient } = require("../miniprogram/services/fosuDirectClient");

const LOGIN_HTML = "<form><input type=\"hidden\" name=\"execution\" value=\"e1\" /><input type=\"hidden\" id=\"pwdEncryptSalt\" value=\"nwxB9tTnv9UJDSX6\" /><input name=\"username\" /><input type=\"password\" name=\"password\" /></form>";
const HOME = "教学综合信息服务平台";
const TIMETABLE = "<meta charset=\"utf-8\"><table id=\"kbtable\"><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr><tr><td>第一大节</td><td>高等数学<br>1-16周<br>[01-02]节<br>A101</td></tr></table>";

function bytes(text) {
  return new TextEncoder().encode(text).buffer;
}

async function run() {
  const calls = [];
  let inflight = 0;
  let maxInflight = 0;
  const transport = {
    manualRedirect: true,
    async request(spec) {
      const tracked = spec.url.includes("xskb_list.do") || spec.url.includes("/grxx/xsxx");
      if (tracked) {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
      }
      await Promise.resolve();
      calls.push({ method: spec.method || "GET", url: spec.url });
      let response;
      if (spec.url.includes("caslogin.jsp") && !spec.url.includes("ticket=")) {
        response = { statusCode: 302, header: { Location: "https://authserver.fosu.edu.cn/authserver/login?service=cas" } };
      } else if (spec.url.includes("/authserver/login") && spec.method !== "POST") {
        response = { statusCode: 200, data: LOGIN_HTML, header: { "Set-Cookie": "JSESSIONID=login; Path=/; Secure" } };
      } else if (spec.url.includes("checkNeedCaptcha")) {
        response = { statusCode: 200, data: "{\"isNeed\":false}" };
      } else if (spec.method === "POST" && spec.url.includes("/authserver/login")) {
        response = { statusCode: 302, header: { Location: "https://100.fosu.edu.cn/caslogin.jsp?ticket=ST-TEST", "Set-Cookie": "CASTGC=secret; Path=/; Secure" } };
      } else if (spec.url.includes("caslogin.jsp")) {
        response = { statusCode: 302, header: { Location: "https://100.fosu.edu.cn/framework/xsMain.jsp" } };
      } else if (spec.url.includes("xsMain.jsp")) {
        response = { statusCode: 200, data: HOME, header: { "Set-Cookie": "JSESSIONID=edu; Path=/; Secure" } };
      } else if (spec.url.includes("xskb_list.do")) {
        response = { statusCode: 200, data: bytes(TIMETABLE), header: { "Content-Type": "text/html; charset=utf-8" } };
      } else if (spec.url.includes("/grxx/xsxx")) {
        response = { statusCode: 200, data: bytes("<td>学号</td><td>202500000303</td><td>姓名</td><td>王同学</td><td>班级</td><td>计科1班</td>"), header: {} };
      } else {
        throw new Error("unexpected " + spec.method + " " + spec.url);
      }
      if (tracked) inflight -= 1;
      return response;
    },
  };
  const result = await createFosuDirectClient({ transport }).readTimetable({
    studentId: "202500000303",
    password: "school-secret",
    semester: "",
  });
  const loginPosts = calls.filter((call) => call.method === "POST" && call.url.includes("/authserver/login"));
  const xskbGets = calls.filter((call) => (call.method || "GET") === "GET" && call.url.includes("xskb_list.do"));
  const profiles = calls.filter((call) => call.url.includes("/grxx/xsxx"));
  const homes = calls.filter((call) => call.url.includes("xsMain.jsp"));
  assert.strictEqual(loginPosts.length, 1);
  assert.strictEqual(xskbGets.length, 1);
  assert.strictEqual(profiles.length, 1);
  assert.strictEqual(homes.length, 1);
  assert.ok(maxInflight >= 2, "xskb and profile should share one logged-in session");
  assert.strictEqual(result.profileHint.profileStatus, "ok");
  assert.ok(result.stageTimings.schoolLoginMs >= 0);
  assert.ok(!JSON.stringify(result).includes("school-secret"));
  assert.ok(!JSON.stringify(result).includes("ST-TEST"));
  assert.ok(!JSON.stringify(calls).includes("school-secret"));

  const jar = createCookieJar();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const left = (async () => {
    jar.cookieHeader("https://100.fosu.edu.cn/xskb/xskb_list.do");
    await gate;
    jar.absorb("https://100.fosu.edu.cn/xskb/xskb_list.do", { header: { "set-cookie": "SID=a; Path=/" } });
  })();
  const right = (async () => {
    jar.cookieHeader("https://100.fosu.edu.cn/grxx/xsxx");
    await gate;
    jar.absorb("https://100.fosu.edu.cn/grxx/xsxx", { header: { "set-cookie": "ROUTE=b; Path=/" } });
  })();
  release();
  await Promise.all([left, right]);
  const header = jar.cookieHeader("https://100.fosu.edu.cn/xskb/xskb_list.do");
  assert.ok(header.includes("SID=a"));
  assert.ok(header.includes("ROUTE=b"));
  console.log("fosu-direct-request-count PASS");
  console.log(JSON.stringify({
    requests: calls.length,
    loginPosts: loginPosts.length,
    xskbGets: xskbGets.length,
    profileGets: profiles.length,
    xsMainGets: homes.length,
    maxInflight,
  }));
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
