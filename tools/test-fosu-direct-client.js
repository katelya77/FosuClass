const assert = require("assert");
const { createCookieJar } = require("../miniprogram/services/fosuDirectCookieJar");
const { createFosuDirectClient, schoolHeaders } = require("../miniprogram/services/fosuDirectClient");

const LOGIN_HTML = [
  "<form>",
  "<input type=\"hidden\" name=\"execution\" value=\"e1\" />",
  "<input type=\"hidden\" id=\"pwdEncryptSalt\" value=\"nwxB9tTnv9UJDSX6\" />",
  "<input type=\"hidden\" name=\"lt\" value=\"lt1\" />",
  "<input name=\"username\" />",
  "<input type=\"password\" name=\"password\" />",
  "</form>",
].join("");

const TIMETABLE = [
  "<meta charset=\"utf-8\">",
  "<select id=\"xnxq01id\"><option value=\"2025-2026-1\" selected>2025-2026-1</option>",
  "<option value=\"2025-2026-2\">2025-2026-2</option></select>",
  "<table id=\"kbtable\"><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr>",
  "<tr><td>第一大节</td><td>高等数学<br>张三<br>1-16周<br>[01-02]节<br>A101</td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>",
].join("");

function bytes(text) {
  return new TextEncoder().encode(text).buffer;
}

function scriptedTransport(handlers) {
  const calls = [];
  return {
    calls,
    manualRedirect: true,
    async request(spec) {
      calls.push({ url: spec.url, method: spec.method || "GET", data: spec.data, header: spec.header || {} });
      assert.ok(spec.url.startsWith("https://"), "school client must not request http");
      const handler = handlers.find((item) => item.match(spec, calls));
      assert.ok(handler, `unexpected ${spec.method} ${spec.url}`);
      return handler.respond(spec);
    },
  };
}

async function run() {
  const jar = createCookieJar();
  const transport = scriptedTransport([
    { match: (spec) => spec.url.startsWith("https://authserver.fosu.edu.cn/authserver/login") && spec.method !== "POST", respond: () => ({ statusCode: 200, data: LOGIN_HTML, header: { "Set-Cookie": "CASTGC=secret; Path=/; Secure" } }) },
    { match: (spec) => spec.url === "https://100.fosu.edu.cn/", respond: () => ({ statusCode: 302, header: { Location: "https://100.fosu.edu.cn/login.jsp" } }) },
    { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":false}" }) },
    { match: (spec) => spec.method === "POST" && spec.url.includes("/authserver/login"), respond: () => ({ statusCode: 302, header: { Location: "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null&ticket=ST-TEST" } }) },
    { match: (spec) => spec.url.startsWith("https://100.fosu.edu.cn/caslogin.jsp"), respond: () => ({ statusCode: 302, header: { Location: "https://100.fosu.edu.cn/framework/xsMain.jsp" } }) },
    { match: (spec) => spec.url.includes("xsMain.jsp"), respond: () => ({ statusCode: 200, data: "教学综合信息服务平台" }) },
    { match: (spec) => spec.url.includes("xskb_list.do") && spec.method !== "POST", respond: () => ({ statusCode: 200, data: bytes(TIMETABLE), header: { "Content-Type": "text/html; charset=utf-8" } }) },
    { match: (spec) => spec.method === "POST" && spec.url.includes("xskb_list.do"), respond: (spec) => ({ statusCode: 200, data: bytes(TIMETABLE.replace("2025-2026-1\" selected", "2025-2026-1\"").replace("2025-2026-2\"", "2025-2026-2\" selected")), header: { "Content-Type": "text/html; charset=utf-8" }, echo: spec.data }) },
  ]);
  const client = createFosuDirectClient({ transport, jar });
  const result = await client.readTimetable({ studentId: "202500000303", password: "school-secret", semester: "2025-2026-2" });
  assert.strictEqual(result.source, "client-direct-fosu100");
  assert.strictEqual(result.profileHint.studentIdMasked, "2025****0303");
  assert.ok(!JSON.stringify(result).includes("school-secret"));
  assert.ok(!JSON.stringify(result).includes("ST-TEST"));
  assert.ok(!JSON.stringify(result).includes("CASTGC"));
  const semesterPost = transport.calls.find((call) => call.method === "POST" && call.url.includes("xskb_list.do"));
  assert.ok(semesterPost && semesterPost.data.includes("xnxq01id=2025-2026-2"));
  assert.ok(transport.calls.some((call) => call.url.startsWith("https://100.fosu.edu.cn/caslogin.jsp") && call.url.includes("ticket=ST-TEST")));
  assert.strictEqual(jar.size(), 0);
  const diagnosticText = JSON.stringify(client.getSafeDiagnostics());
  assert.ok(diagnosticText.includes("\"stage\":\"preflight\""));
  assert.ok(diagnosticText.includes("\"stage\":\"cas-redirect\""));
  assert.ok(diagnosticText.includes("authReachable\":true"));
  assert.ok(!diagnosticText.includes("school-secret"));
  assert.ok(!diagnosticText.includes("ST-TEST"));
  assert.ok(!diagnosticText.includes("nwxB9tTnv9UJDSX6"));
  assert.ok(!diagnosticText.includes("CASTGC=secret"));
  assert.ok(!diagnosticText.includes("timetableBodyBase64"));
  transport.calls.forEach((call) => {
    const names = Object.keys(call.header || {});
    assert.ok(!names.some((name) => /authorization|x-fosu-session|x-fosu-static-ticket|referer/i.test(name)));
  });
  const stripped = schoolHeaders({
    Authorization: "Bearer secret",
    "X-Fosu-Session": "session",
    "X-Fosu-Static-Ticket": "ticket",
    Referer: "https://class.katelya.eu.org",
    "Content-Type": "application/x-www-form-urlencoded",
  }, "CASTGC=secret");
  assert.strictEqual(stripped.Authorization, undefined);
  assert.strictEqual(stripped["X-Fosu-Session"], undefined);
  assert.strictEqual(stripped["Content-Type"], "application/x-www-form-urlencoded");
  assert.strictEqual(stripped.Cookie, "CASTGC=secret");

  const unsupported = createFosuDirectClient({ transport: { manualRedirect: false, request() { throw new Error("should not request"); } } });
  await assert.rejects(() => unsupported.readTimetable({ studentId: "202500000303", password: "x" }), (error) => error.code === "DIRECT_MODE_UNSUPPORTED");

  const captcha = scriptedTransport([
    { match: (spec) => spec.url.startsWith("https://authserver.fosu.edu.cn/authserver/login") && spec.method !== "POST", respond: () => ({ statusCode: 200, data: LOGIN_HTML }) },
    { match: (spec) => spec.url === "https://100.fosu.edu.cn/", respond: () => ({ statusCode: 200, data: "ok" }) },
    { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":true}" }) },
  ]);
  await assert.rejects(
    () => createFosuDirectClient({ transport: captcha }).readTimetable({ studentId: "202500000303", password: "x" }),
    (error) => error.code === "INTERACTIVE_CHALLENGE_REQUIRED"
  );

  const badPassword = scriptedTransport([
    { match: (spec) => spec.url.startsWith("https://authserver.fosu.edu.cn/authserver/login") && spec.method !== "POST", respond: () => ({ statusCode: 200, data: LOGIN_HTML }) },
    { match: (spec) => spec.url === "https://100.fosu.edu.cn/", respond: () => ({ statusCode: 200, data: "ok" }) },
    { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":false}" }) },
    { match: (spec) => spec.method === "POST", respond: () => ({ statusCode: 200, data: "<div>用户名或密码错误</div>" }) },
  ]);
  await assert.rejects(
    () => createFosuDirectClient({ transport: badPassword }).readTimetable({ studentId: "202500000303", password: "wrong" }),
    (error) => error.code === "INVALID_CREDENTIALS"
  );

  const offline = { manualRedirect: true, async request() { const error = new Error("offline"); error.code = "CAMPUS_NETWORK_REQUIRED"; throw error; } };
  await assert.rejects(
    () => createFosuDirectClient({ transport: offline }).readTimetable({ studentId: "202500000303", password: "x" }),
    (error) => error.code === "CAMPUS_NETWORK_REQUIRED"
  );

  const untrusted = scriptedTransport([
    { match: (spec) => spec.url.startsWith("https://authserver.fosu.edu.cn/authserver/login") && spec.method !== "POST", respond: () => ({ statusCode: 302, header: { Location: "https://evil.example/cas" } }) },
    { match: (spec) => spec.url === "https://100.fosu.edu.cn/", respond: () => ({ statusCode: 200, data: "ok" }) },
  ]);
  await assert.rejects(
    () => createFosuDirectClient({ transport: untrusted }).readTimetable({ studentId: "202500000303", password: "x" }),
    (error) => error.code === "UNTRUSTED_REDIRECT"
  );

  console.log("test-fosu-direct-client passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
