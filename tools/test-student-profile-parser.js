const assert = require("assert");
const path = require("path");
const { parseStudentProfileHtml } = require("../miniprogram/services/studentProfileParser");
const { decodeSchoolHtml } = require("../miniprogram/services/schoolHtmlCharset");
const { createFosuDirectClient } = require("../miniprogram/services/fosuDirectClient");
const personalSyncCredentialStore = require("../miniprogram/services/personalSyncCredentialStore");

const iconv = require(path.join(__dirname, "..", "server", "node_modules", "iconv-lite"));

const PII = {
  idCard: "440101199001011234",
  phone: "13800000000",
  address: "TEST_PRIVATE_ADDRESS",
};

function profileHtml(studentId) {
  return [
    "<html><head><meta charset=\"utf-8\"></head><body><table>",
    "<tr><td>姓名</td><td><span>王奕章</span></td></tr>",
    "<tr><td>班级：</td><td>25动物医学6</td></tr>",
    `<tr><td>学号</td><td>${studentId}</td></tr>`,
    `<tr><td>身份证编号</td><td>${PII.idCard}</td></tr>`,
    `<tr><td>联系电话</td><td>${PII.phone}</td></tr>`,
    `<tr><td>家庭地址</td><td>${PII.address}</td></tr>`,
    "<tr><td>民族</td><td>汉族</td></tr>",
    "</table></body></html>",
  ].join("");
}

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
  "<table id=\"kbtable\"><tr><td>节次</td><td>星期一</td></tr>",
  "<tr><td>第一大节</td><td>高等数学<br>1-16周<br>[01-02]节<br>A101</td></tr></table>",
].join("");

function bytes(text, encoding) {
  const encoded = encoding ? iconv.encode(text, encoding) : Buffer.from(text);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

function scriptedTransport(profile) {
  const calls = [];
  const handlers = [
    { match: (spec) => spec.url.startsWith("https://100.fosu.edu.cn/caslogin.jsp") && !spec.url.includes("ticket="), respond: () => ({ statusCode: 302, header: { Location: "https://authserver.fosu.edu.cn/authserver/login?service=cas" } }) },
    { match: (spec) => spec.url.startsWith("https://authserver.fosu.edu.cn/authserver/login") && spec.method !== "POST", respond: () => ({ statusCode: 200, data: LOGIN_HTML }) },
    { match: (spec) => spec.url.includes("checkNeedCaptcha"), respond: () => ({ statusCode: 200, data: "{\"isNeed\":false}" }) },
    { match: (spec) => spec.method === "POST" && spec.url.includes("/authserver/login"), respond: () => ({ statusCode: 302, header: { Location: "https://100.fosu.edu.cn/caslogin.jsp?ticket=ST-TEST" } }) },
    { match: (spec) => spec.url.startsWith("https://100.fosu.edu.cn/caslogin.jsp"), respond: () => ({ statusCode: 302, header: { Location: "https://100.fosu.edu.cn/framework/xsMain.jsp" } }) },
    { match: (spec) => spec.url.includes("xsMain.jsp"), respond: () => ({ statusCode: 200, data: profile.home || "教学综合信息服务平台" }) },
    { match: (spec) => spec.url.includes("xskb_list.do"), respond: () => ({ statusCode: 200, data: bytes(TIMETABLE), header: { "Content-Type": "text/html; charset=utf-8" } }) },
    { match: (spec) => spec.url.includes("/grxx/xsxx"), respond: (spec) => profile.respond(spec, calls) },
  ];
  return {
    calls,
    manualRedirect: true,
    async request(spec) {
      calls.push({ url: spec.url, method: spec.method || "GET" });
      const handler = handlers.find((item) => item.match(spec));
      assert.ok(handler, spec.url);
      return handler.respond(spec, calls);
    },
  };
}

function assertNoPii(value) {
  const text = JSON.stringify(value);
  assert.ok(!text.includes(PII.idCard));
  assert.ok(!text.includes(PII.phone));
  assert.ok(!text.includes(PII.address));
  assert.ok(!text.includes("profileBodyBase64"));
  assert.ok(!text.includes("rawProfileHtml"));
  assert.ok(!text.includes("汉族"));
}

async function run() {
  const parsed = parseStudentProfileHtml(profileHtml("20250410303"));
  assert.deepStrictEqual(Object.keys(parsed).sort(), ["className", "studentId", "studentName"]);
  assert.strictEqual(parsed.studentName, "王奕章");
  assert.strictEqual(parsed.className, "25动物医学6");
  assert.strictEqual(parsed.studentId, "20250410303");
  assertNoPii({ studentName: parsed.studentName, className: parsed.className });
  console.log("test-student-profile-parser ok");

  const gbkHtml = profileHtml("20250410303").replace("utf-8", "gbk");
  const gbk = decodeSchoolHtml(Buffer.from(iconv.encode(gbkHtml, "gbk")), "text/html; charset=gbk", iconv);
  const gbkParsed = parseStudentProfileHtml(gbk.html);
  assert.strictEqual(gbkParsed.studentName, "王奕章");
  assert.strictEqual(gbkParsed.className, "25动物医学6");
  const utf8 = decodeSchoolHtml(Buffer.from(profileHtml("20250410303")), "text/html; charset=utf-8", iconv);
  assert.strictEqual(parseStudentProfileHtml(utf8.html).studentName, "王奕章");
  console.log("charset test ok");

  const okTransport = scriptedTransport({
    respond: () => ({ statusCode: 200, data: bytes(profileHtml("20250410303")), header: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  const ok = await createFosuDirectClient({
    transport: okTransport,
    decodeSchoolHtml: (data, contentType) => decodeSchoolHtml(data, contentType, iconv),
  }).readTimetable({ studentId: "20250410303", password: "school-secret" });
  assert.strictEqual(ok.profileHint.studentName, "王奕章");
  assert.strictEqual(ok.profileHint.className, "25动物医学6");
  assert.strictEqual(ok.profileHint.studentIdMasked, "2025****0303");
  assert.strictEqual(ok.profileHint.studentIdMatched, true);
  assert.strictEqual(ok.profileHint.source, "grxx/xsxx");
  assert.strictEqual(ok.profileHint.profileStatus, "ok");
  assert.ok(!ok.profileHint.studentId);
  assert.ok(ok.timetableBodyBase64);
  assertNoPii(ok);
  const timetableAt = okTransport.calls.findIndex((call) => call.url.includes("xskb_list.do"));
  const profileAt = okTransport.calls.findIndex((call) => call.url.includes("/grxx/xsxx"));
  assert.ok(timetableAt >= 0 && profileAt === timetableAt + 1);
  assert.strictEqual(okTransport.calls.filter((call) => call.url.includes("/authserver/login") && call.method === "POST").length, 1);
  console.log("PROFILE_PII_MINIMIZATION ok");

  const mismatch = scriptedTransport({
    respond: () => ({ statusCode: 200, data: bytes(profileHtml("20259999999")), header: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  await assert.rejects(
    () => createFosuDirectClient({
      transport: mismatch,
      decodeSchoolHtml: (data, contentType) => decodeSchoolHtml(data, contentType, iconv),
    }).readTimetable({ studentId: "20250410303", password: "school-secret" }),
    (error) => error.code === "PROFILE_ID_MISMATCH"
  );
  console.log("profile id mismatch ok");

  const unavailable = scriptedTransport({
    respond: () => ({ statusCode: 500, data: "", header: {} }),
  });
  const partial = await createFosuDirectClient({
    transport: unavailable,
    decodeSchoolHtml: (data, contentType) => decodeSchoolHtml(data, contentType, iconv),
  }).readTimetable({ studentId: "20250410303", password: "school-secret" });
  assert.ok(partial.timetableBodyBase64);
  assert.strictEqual(partial.profileHint.studentName, "");
  assert.strictEqual(partial.profileHint.className, "");
  assert.strictEqual(partial.profileHint.profileStatus, "unavailable");
  console.log("profile unavailable ok");

  const saved = {
    identityConfirmed: true,
    studentId: "20250410303",
    confirmedStudentName: "王奕章",
    confirmedClassName: "25动物医学6",
  };
  assert.strictEqual(personalSyncCredentialStore.sameConfirmedIdentity(saved, "20250410303", "王奕章", "25动物医学6"), true);
  assert.strictEqual(personalSyncCredentialStore.sameConfirmedIdentity(saved, "20250410303", "王奕章", "25动物医学7"), false);
  console.log("quick resync identity ok");
  console.log("test-student-profile-parser passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
