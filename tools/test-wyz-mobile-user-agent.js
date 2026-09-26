const assert = require("assert");
const { createFosuDirectClient, buildSchoolRequestHeaders, SCHOOL_MOBILE_USER_AGENT } = require("../miniprogram/services/fosuDirectClient");
const agent = require("../deploy/wyz-campus-agent/src/index");

const PASSWORD = "pw-Route2-Secret";
const STUDENT = "202199887766";
const EXECUTION = "exec-hidden-value";
const TICKET = "ST-hidden-ticket";
const DESKTOP_UA = "DesktopSomething";
const SALT = "nwxB9tTnv9UJDSX6";

const MOBILE_FORM = [
  "<form action=\"https://100.fosu.edu.cn/m/login\">",
  `<input type="hidden" name="execution" value="${EXECUTION}" />`,
  `<input type="hidden" id="pwdEncryptSalt" value="${SALT}" />`,
  "<input name=\"username\" />",
  "<input type=\"password\" name=\"password\" />",
  "</form>",
].join("");

const CAS_FORM = [
  "<form>",
  `<input type="hidden" name="execution" value="${EXECUTION}" />`,
  `<input type="hidden" id="pwdEncryptSalt" value="${SALT}" />`,
  "<input name=\"username\" />",
  "<input type=\"password\" name=\"password\" />",
  "</form>",
].join("");

const HOME_HTML = "<html><body>教学综合信息服务平台 桌面</body></html>";
const TIMETABLE = [
  "<meta charset=\"utf-8\">",
  "<table id=\"kbtable\"><tr><td>节次</td><td>星期一</td><td>星期二</td></tr>",
  "<tr><td>第一大节</td><td>高等数学</td><td></td></tr></table>",
].join("");

function fakeRequest(queue, calls) {
  return function requestFor() {
    return {
      request(options, callback) {
        const pathOnly = String(options.path || "").split("?")[0];
        calls.push({
          host: options.hostname,
          pathname: pathOnly,
          method: options.method || "GET",
          userAgent: options.headers && options.headers["User-Agent"] || "",
          hasReferer: Boolean(options.headers && (options.headers.Referer || options.headers.referer)),
          hasOrigin: Boolean(options.headers && (options.headers.Origin || options.headers.origin)),
          hasAuthorization: Boolean(options.headers && (options.headers.Authorization || options.headers.authorization)),
        });
        const script = queue.shift();
        const req = {
          on() { return req; },
          write() {},
          end() {
            if (!script) throw new Error("missing scripted school response");
            const res = {
              statusCode: script.statusCode,
              headers: script.headers || {},
              on(event, fn) {
                if (event === "data") fn(Buffer.from(script.body || ""));
                if (event === "end") fn();
              },
            };
            callback(res);
          },
          destroy() {},
        };
        return req;
      },
    };
  };
}

function clientWith(queue, calls) {
  return createFosuDirectClient({
    transport: agent.createNodeTransport({ requestFor: fakeRequest(queue, calls) }),
    decodeSchoolHtml(data) {
      if (Buffer.isBuffer(data) || data instanceof Uint8Array) return Buffer.from(data).toString("utf8");
      return String(data || "");
    },
  });
}

function assertSafeCapture(calls) {
  const text = JSON.stringify(calls);
  assert.ok(!text.includes(PASSWORD), "capture recorded password");
  assert.ok(!text.includes(STUDENT), "capture recorded studentId");
  assert.ok(!text.includes(EXECUTION), "capture recorded execution");
  assert.ok(!text.includes(TICKET), "capture recorded ticket");
  assert.ok(!/cookie/i.test(text), "capture recorded cookie");
  calls.forEach((call) => {
    assert.strictEqual(call.userAgent, SCHOOL_MOBILE_USER_AGENT);
    assert.strictEqual(call.hasReferer, false);
    assert.strictEqual(call.hasOrigin, false);
    assert.strictEqual(call.hasAuthorization, false);
    assert.ok(!call.pathname.includes("?"));
  });
}

async function main() {
  const stripped = buildSchoolRequestHeaders("https://100.fosu.edu.cn/caslogin.jsp", {
    "User-Agent": DESKTOP_UA,
    "user-agent": DESKTOP_UA,
  }, null);
  assert.strictEqual(stripped["User-Agent"], undefined);
  assert.strictEqual(stripped["user-agent"], undefined);

  const injected = [];
  const transport = agent.createNodeTransport({
    requestFor: fakeRequest([{ statusCode: 204, body: "" }], injected),
  });
  await transport.request({
    url: "https://100.fosu.edu.cn/caslogin.jsp?ticket=" + TICKET,
    method: "GET",
    header: { "User-Agent": DESKTOP_UA, Cookie: "JSESSIONID=cookie-hidden" },
  });
  assert.strictEqual(injected[0].userAgent, SCHOOL_MOBILE_USER_AGENT);
  assert.strictEqual(injected[0].pathname, "/caslogin.jsp");
  assertSafeCapture(injected);

  const mobileCalls = [];
  const mobile = clientWith([
    { statusCode: 302, headers: { location: "https://100.fosu.edu.cn/m/login" } },
    { statusCode: 200, body: MOBILE_FORM },
    { statusCode: 302, headers: { location: "https://100.fosu.edu.cn/framework/xsMain.jsp?ticket=" + TICKET } },
    { statusCode: 200, body: HOME_HTML },
    { statusCode: 200, body: TIMETABLE },
    { statusCode: 200, body: "<html></html>" },
  ], mobileCalls);
  const synced = await mobile.readTimetable({ studentId: STUDENT, password: PASSWORD });
  assert.ok(synced.timetableBodyBase64);
  assert.strictEqual(synced.authMode, "mobile");
  assert.ok(mobileCalls.every((call) => call.userAgent === SCHOOL_MOBILE_USER_AGENT));
  assert.ok(mobileCalls.some((call) => call.host === "100.fosu.edu.cn" && call.pathname === "/caslogin.jsp"));
  assert.ok(mobileCalls.some((call) => call.host === "100.fosu.edu.cn" && call.pathname === "/m/login"));
  assert.ok(mobileCalls.some((call) => call.pathname === "/xskb/xskb_list.do"));
  assert.ok(mobileCalls.some((call) => call.pathname === "/grxx/xsxx"));
  assert.ok(!mobileCalls.some((call) => call.pathname.indexOf("checkNeedCaptcha") >= 0));
  assert.strictEqual(mobileCalls.filter((call) => call.method === "POST").length, 1);
  assertSafeCapture(mobileCalls);

  const challengeCalls = [];
  const challenge = clientWith([
    { statusCode: 302, headers: { location: "https://authserver.fosu.edu.cn/authserver/login?service=cas" } },
    { statusCode: 200, body: CAS_FORM },
    { statusCode: 200, body: "{\"isNeed\":true}" },
  ], challengeCalls);
  await assert.rejects(
    () => challenge.readTimetable({ studentId: STUDENT, password: PASSWORD }),
    (error) => error && error.code === "INTERACTIVE_CHALLENGE_REQUIRED"
  );
  assert.ok(challengeCalls.some((call) => call.host === "authserver.fosu.edu.cn" && call.pathname.indexOf("/authserver/login") === 0));
  assert.ok(challengeCalls.some((call) => call.pathname.indexOf("checkNeedCaptcha") >= 0));
  assert.ok(!challengeCalls.some((call) => call.method === "POST" && call.pathname.indexOf("checkNeedCaptcha") < 0));
  assertSafeCapture(challengeCalls);

  const badCalls = [];
  const bad = clientWith([
    { statusCode: 302, headers: { location: "https://authserver.fosu.edu.cn/authserver/login?service=cas" } },
    { statusCode: 200, body: CAS_FORM },
    { statusCode: 200, body: "{\"isNeed\":false}" },
    { statusCode: 200, body: "密码错误" },
  ], badCalls);
  await assert.rejects(
    () => bad.readTimetable({ studentId: STUDENT, password: PASSWORD }),
    (error) => error && error.code === "INVALID_CREDENTIALS"
  );
  assert.strictEqual(badCalls.filter((call) => call.pathname.indexOf("checkNeedCaptcha") >= 0).length, 1);
  assert.strictEqual(badCalls.filter((call) => call.method === "POST" && call.pathname.indexOf("/authserver/login") === 0).length, 1);
  assertSafeCapture(badCalls);

  const explicitCalls = [];
  const explicitChallenge = clientWith([
    { statusCode: 200, body: "<html>请完成安全验证</html>" },
  ], explicitCalls);
  await assert.rejects(
    () => explicitChallenge.readTimetable({ studentId: STUDENT, password: PASSWORD }),
    (error) => error && error.code === "INTERACTIVE_CHALLENGE_REQUIRED"
  );
  assert.strictEqual(explicitCalls.length, 1);
  assert.ok(!explicitCalls.some((call) => call.pathname.indexOf("checkNeedCaptcha") >= 0));
  assertSafeCapture(explicitCalls);

  const changedCalls = [];
  const changed = clientWith([
    { statusCode: 200, body: "<html>unexpected portal</html>" },
  ], changedCalls);
  await assert.rejects(
    () => changed.readTimetable({ studentId: STUDENT, password: PASSWORD }),
    (error) => error && error.code === "AUTH_PAGE_CHANGED"
  );
  assert.ok(!changedCalls.some((call) => call.pathname.indexOf("checkNeedCaptcha") >= 0));

  const sessionCalls = [];
  const session = clientWith([
    { statusCode: 302, headers: { location: "https://100.fosu.edu.cn/framework/xsMain.jsp" } },
    { statusCode: 200, body: HOME_HTML },
    { statusCode: 200, body: TIMETABLE },
    { statusCode: 200, body: "<html></html>" },
  ], sessionCalls);
  const resumed = await session.readTimetable({ studentId: STUDENT, password: PASSWORD });
  assert.ok(resumed.timetableBodyBase64);
  assert.strictEqual(resumed.authMode, "authenticated-session");
  assert.ok(!sessionCalls.some((call) => call.method === "POST"));
  assert.ok(!sessionCalls.some((call) => call.pathname.indexOf("checkNeedCaptcha") >= 0));
  assertSafeCapture(sessionCalls);

  assert.strictEqual(agent.publicAuthMode("cas"), "cas");
  assert.strictEqual(agent.publicAuthMode("desktop"), "");

  console.log("wyz-mobile-user-agent PASS");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
