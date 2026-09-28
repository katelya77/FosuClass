const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-auth-error-"));
process.env.CAMPUS_SYNC_CHALLENGE_COOLDOWN_SECONDS = "600";
process.env.CAMPUS_SYNC_RATE_LIMIT = "5";
process.env.CAMPUS_SYNC_DAILY_LIMIT = "10";

const { captchaRequiredFromCheck, challengeReasonFromPage, classifyLoginPage } = require("../miniprogram/services/fosuDirectHtml");
const { createFosuDirectClient } = require("../miniprogram/services/fosuDirectClient");
const { applyPersonalSyncFailure } = require("../miniprogram/services/personalSyncFailureTransition");
const { presentPersonalSyncError } = require("../miniprogram/services/personalSyncErrorPresenter");
const agent = require("../deploy/wyz-campus-agent/src/index");
const cooldown = require("../server/src/services/campusSyncChallengeCooldown");
const broker = require("../server/src/services/campusSyncBroker");
const telemetry = require("../server/src/services/campusSyncTelemetryService");

const LOGIN_FIELDS = "<form><input name='execution' value='e1'><input id='pwdEncryptSalt' value='nwxB9tTnv9UJDSX6'><input name='username'><input name='password'></form>";
const MIXED = "<html><body><div>安全验证</div><p>密码错误</p></body></html>";
const CHALLENGE_ONLY = "<html><body>请完成滑块安全验证</body></html>";
const FORM_AND_ERROR = "<form><input name='username'><input name='password'></form><div>账号或密码错误</div><div>安全验证</div>";

assert.strictEqual(classifyLoginPage(MIXED), "INVALID_CREDENTIALS");
assert.strictEqual(classifyLoginPage(CHALLENGE_ONLY), "INTERACTIVE_CHALLENGE_REQUIRED");
assert.strictEqual(classifyLoginPage(FORM_AND_ERROR), "INVALID_CREDENTIALS");
assert.strictEqual(classifyLoginPage("<html>请登录教务系统</html>"), "");
assert.strictEqual(classifyLoginPage("<html>用户名或密码有误，请重试。页面含安全验证</html>"), "INVALID_CREDENTIALS");
assert.strictEqual(challengeReasonFromPage("<html>风险验证</html>", "after-password"), "risk-control");
assert.strictEqual(challengeReasonFromPage(CHALLENGE_ONLY, "after-password"), "postlogin-challenge");
assert.strictEqual(challengeReasonFromPage(CHALLENGE_ONLY, "before-password"), "prelogin-captcha");
assert.strictEqual(captchaRequiredFromCheck("{\"isNeed\":true}"), true);
assert.strictEqual(captchaRequiredFromCheck("{\"isNeed\":false}"), false);

function scripted(handlers) {
  const calls = [];
  return {
    calls,
    manualRedirect: true,
    async request(spec) {
      calls.push({ url: spec.url, method: spec.method || "GET" });
      const page = handlers.find((item) => item.match(spec));
      assert.ok(page, spec.method + " " + spec.url);
      return page.respond(spec);
    },
  };
}

function casHandlers(extra) {
  return [
    { match: (spec) => spec.url.includes("caslogin.jsp") && !spec.url.includes("ticket="), respond: () => ({ statusCode: 302, header: { Location: "https://authserver.fosu.edu.cn/authserver/login?service=cas" } }) },
    { match: (spec) => spec.url.includes("/authserver/login") && spec.method !== "POST", respond: () => ({ statusCode: 200, data: LOGIN_FIELDS }) },
  ].concat(extra);
}

function passwordPosts(calls) {
  return calls.filter((call) => call.method === "POST" && call.url.includes("/authserver/login") && !call.url.includes("checkNeedCaptcha"));
}

async function read(handlers) {
  return createFosuDirectClient({ transport: scripted(handlers) }).readTimetable({
    studentId: "202500000101",
    password: "fixture-password",
  });
}

async function clientCases() {
  const captcha = scripted(casHandlers([
    { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":true}" }) },
    { match: () => true, respond: () => { throw new Error("password must not be posted"); } },
  ]));
  await assert.rejects(
    () => createFosuDirectClient({ transport: captcha }).readTimetable({ studentId: "202500000101", password: "fixture-password" }),
    (error) => {
      assert.strictEqual(error.code, "INTERACTIVE_CHALLENGE_REQUIRED");
      assert.strictEqual(error.challengeReason, "prelogin-captcha");
      assert.ok(!error.html);
      return true;
    }
  );
  assert.strictEqual(passwordPosts(captcha.calls).length, 0);

  const wrong = scripted(casHandlers([
    { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":false}" }) },
    { match: (spec) => spec.method === "POST" && spec.url.includes("/authserver/login"), respond: () => ({ statusCode: 200, data: MIXED }) },
  ]));
  await assert.rejects(
    () => createFosuDirectClient({ transport: wrong }).readTimetable({ studentId: "202500000101", password: "fixture-password" }),
    (error) => error.code === "INVALID_CREDENTIALS" && !error.challengeReason
  );
  assert.strictEqual(passwordPosts(wrong.calls).length, 1);

  await assert.rejects(
    () => read(casHandlers([
      { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":false}" }) },
      { match: (spec) => spec.method === "POST", respond: () => ({ statusCode: 200, data: "<html>公告页</html>" }) },
    ])),
    (error) => error.code === "AUTH_PAGE_CHANGED"
  );
  assert.strictEqual(agent.safeCode({ code: "AUTH_PAGE_CHANGED" }), "STRUCTURE_CHANGED");
  assert.deepStrictEqual(agent.failureReport({
    code: "INTERACTIVE_CHALLENGE_REQUIRED",
    challengeReason: "<html>安全验证</html>",
    authMode: "cas",
  }), { success: false, code: "INTERACTIVE_CHALLENGE_REQUIRED", authMode: "cas" });
  assert.deepStrictEqual(agent.failureReport({
    code: "INTERACTIVE_CHALLENGE_REQUIRED",
    challengeReason: "postlogin-challenge",
  }), { success: false, code: "INTERACTIVE_CHALLENGE_REQUIRED", challengeReason: "postlogin-challenge" });
}

function owner(name) {
  return { fosuSession: { openidHash: name }, ip: "10.1.1.1" };
}

async function finishFailure(session, code, extra) {
  const created = broker.createJob(session, { studentId: "202500000101", password: "fixture-password", semester: "2025-2026-1" });
  const job = await broker.claimJob("wyz-campus-01", 0);
  assert.ok(job);
  const payload = broker.claimPayload(job);
  broker.finishJob(payload.jobId, Object.assign({ success: false, code }, extra || {}));
  return created;
}

async function cooldownCases() {
  cooldown.resetForTests();
  broker.resetCampusSyncForTests();
  telemetry.resetForTests();
  const wrongOwner = owner("principal-wrong-password");
  await finishFailure(wrongOwner, "INVALID_CREDENTIALS");
  assert.strictEqual(cooldown.check(wrongOwner.fosuSession.openidHash).blocked, false);
  const again = broker.createJob(wrongOwner, { studentId: "202500000101", password: "fixture-password" });
  assert.strictEqual(again.status, "queued");
  const queued = await broker.claimJob("wyz-campus-01", 0);
  broker.finishJob(broker.claimPayload(queued).jobId, { success: false, code: "EMPTY_PERSONAL_SCHEDULE" });
  assert.strictEqual(cooldown.check(wrongOwner.fosuSession.openidHash).blocked, false);

  for (const code of ["LOGIN_REJECTED", "PROFILE_ID_MISMATCH", "STRUCTURE_CHANGED", "EMPTY_PERSONAL_SCHEDULE"]) {
    const session = owner("principal-" + code.toLowerCase());
    await finishFailure(session, code);
    assert.strictEqual(cooldown.check(session.fosuSession.openidHash).blocked, false, code);
  }

  const challengeOwner = owner("principal-real-challenge");
  await finishFailure(challengeOwner, "INTERACTIVE_CHALLENGE_REQUIRED", { challengeReason: "postlogin-challenge" });
  assert.throws(() => broker.createJob(challengeOwner, { studentId: "202500000101", password: "fixture-password" }), (error) => {
    assert.strictEqual(error.code, "INTERACTIVE_CHALLENGE_REQUIRED");
    assert.ok(error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 600);
    assert.strictEqual(error.challengeReason, "postlogin-challenge");
    return true;
  });

  const htmlOwner = owner("principal-html-reason");
  await finishFailure(htmlOwner, "INTERACTIVE_CHALLENGE_REQUIRED", { challengeReason: "<div>安全验证</div>" });
  const stored = cooldown.check(htmlOwner.fosuSession.openidHash);
  assert.strictEqual(stored.blocked, true);
  assert.strictEqual(stored.reason, "");
  assert.ok(!JSON.stringify(stored).includes("安全验证"));
  assert.ok(!JSON.stringify(stored).includes("fixture-password"));

  const overview = telemetry.overview("24h");
  assert.ok(overview.credentialFailures >= 1);
  assert.ok(overview.schoolChallenges >= 1);
  assert.strictEqual(overview.challengeReasons["postlogin-challenge"] >= 1, true);
  assert.ok(!JSON.stringify(overview).includes("fixture-password"));
  assert.ok(!JSON.stringify(overview).includes("<div>"));
  const events = telemetry.listRecent({ limit: 20 }).events;
  events.forEach((event) => {
    const text = JSON.stringify(event);
    assert.ok(!text.includes("fixture-password"));
    assert.ok(!text.includes("202500000101"));
    assert.ok(!text.includes("<div>"));
    if (event.challengeReason) assert.ok(["prelogin-captcha", "postlogin-challenge", "risk-control"].includes(event.challengeReason));
  });
}

function copyCases() {
  const saved = applyPersonalSyncFailure({ code: "INVALID_CREDENTIALS" }, {
    usingSavedPassword: true,
    password: "fixture-password",
    studentId: "202500000101",
  });
  assert.strictEqual(saved.view.title, "学号或密码错误");
  assert.strictEqual(saved.view.content, "学校账号验证未通过，请检查学号和密码后重新尝试。");
  assert.strictEqual(saved.view.confirmText, "重新输入");
  assert.strictEqual(saved.patch.studentImportLoading, false);
  assert.strictEqual(saved.patch.passwordInputFocus, true);
  assert.strictEqual(saved.credentialPatch.clearSavedPassword, true);
  assert.strictEqual(saved.credentialPatch.saveCredential, false);
  assert.ok(!JSON.stringify(saved.patch).includes("fixture-password"));
  assert.ok(!Object.prototype.hasOwnProperty.call(saved.patch, "studentForm.studentId"));

  const typed = applyPersonalSyncFailure({ code: "INVALID_CREDENTIALS" }, {
    usingSavedPassword: false,
    password: "fixture-password",
    studentId: "202500000101",
  });
  assert.strictEqual(typed.credentialPatch.clearSavedPassword, false);
  assert.strictEqual(typed.credentialPatch.saveCredential, false);

  const prelogin = presentPersonalSyncError({ code: "INTERACTIVE_CHALLENGE_REQUIRED", challengeReason: "prelogin-captcha" });
  assert.strictEqual(prelogin.title, "学校登录需要额外验证");
  assert.ok(prelogin.content.includes("本次尚未完成账号密码校验"));
  assert.ok(!prelogin.content.includes("学号或密码错误"));
  const cooled = presentPersonalSyncError({ code: "INTERACTIVE_CHALLENGE_REQUIRED", retryAfterSeconds: 600 });
  assert.strictEqual(cooled.title, "学校登录暂时需要验证");
  assert.ok(cooled.content.includes("10 分钟后再试"));
  const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
  assert.ok(page.includes("_reenterPasswordFocus"));
  assert.ok(page.includes("passwordInputFocus: true"));
  const forbidden = /HTTP\s*403|HTTP\s*429|HMAC|nonce/i;
  ["INVALID_CREDENTIALS", "CAMPUS_SYNC_RATE_LIMITED", "CAMPUS_SYNC_DAILY_LIMIT", "CAMPUS_SYNC_CONCURRENT_LIMIT", "CAMPUS_SYNC_BUSY", "CAMPUS_SYNC_MAINTENANCE", "AGENT_OFFLINE", "TIMEOUT", "SCHOOL_UNAVAILABLE", "INTERACTIVE_CHALLENGE_REQUIRED", "PROFILE_ID_MISMATCH", "STRUCTURE_CHANGED", "EMPTY_PERSONAL_SCHEDULE", "SESSION_EXPIRED", "UNKNOWN_SYNC_ERROR"].forEach((code) => {
    const view = presentPersonalSyncError({ code, retryAfterSeconds: code === "CAMPUS_SYNC_RATE_LIMITED" ? 45 : 0, requestId: "ab12cd34" });
    assert.ok(!forbidden.test(view.title + view.content), code);
    assert.ok(!view.content.includes(code), code);
  });
}

clientCases()
  .then(cooldownCases)
  .then(() => {
    copyCases();
    console.log("personal-sync-auth-error-semantics PASS");
  })
  .catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
