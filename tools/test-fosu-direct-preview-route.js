const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function requireServerDependency(name) {
  return require(require.resolve(name, { paths: [path.join(__dirname, "..", "server")] }));
}

process.env.NODE_ENV = "development";
process.env.FOSU_SESSION_SECRET = "test-session-secret";
process.env.FOSU_RECENT_IMPORT_STORE_FILE = path.join(os.tmpdir(), `fosu-direct-recent-${process.pid}.json`);

const express = requireServerDependency("express");
const iconv = requireServerDependency("iconv-lite");
const router = require("../server/src/routes/studentScheduleImport");
const { createSessionToken } = require("../server/src/utils/apiSecurity");
const { confirmStudentScheduleImport } = require("../server/src/services/studentScheduleImportService");

const HTML = [
  "<meta charset=\"utf-8\">",
  "<table id=\"kbtable\"><tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr>",
  "<tr><td>第一大节</td><td>高等数学<br>张三<br>1-16周<br>[01-02]节<br>A101</td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>",
].join("");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function requestJson(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    data: await response.json(),
  };
}

async function run() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map((item) => String(item)).join(" "));
  };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/schedule-import/fosu", router);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = createSessionToken({ appid: "wx-test", openid: "direct-preview-user" });
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "FosuClass-Test",
    "x-fosu-session": session.token,
  };
  try {
    const missing = await requestJson(baseUrl, "/api/schedule-import/fosu/direct/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "FosuClass-Test" },
      body: "{}",
    });
    assert.strictEqual(missing.status, 401);

    const secret = await requestJson(baseUrl, "/api/schedule-import/fosu/direct/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "client-direct-fosu100",
        password: "nope",
        timetableBodyBase64: Buffer.from(HTML).toString("base64"),
      }),
    });
    assert.strictEqual(secret.status, 400);
    assert.strictEqual(secret.data.code, "DIRECT_SECRET_REJECTED");

    const utf8 = await requestJson(baseUrl, "/api/schedule-import/fosu/direct/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "client-direct-fosu100",
        timetableBodyBase64: Buffer.from(HTML).toString("base64"),
        contentType: "text/html; charset=utf-8",
        semester: "2025-2026-2",
        profileHint: { studentIdMasked: "2025****0303" },
      }),
    });
    assert.strictEqual(utf8.status, 200);
    assert.strictEqual(utf8.cacheControl, "no-store");
    const oversized = await requestJson(baseUrl, "/api/schedule-import/fosu/direct/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "client-direct-fosu100",
        timetableBodyBase64: "A".repeat(1700001),
      }),
    });
    assert.strictEqual(oversized.status, 400);
    assert.strictEqual(oversized.data.code, "DIRECT_BODY_TOO_LARGE");
    assert.ok(utf8.data.importPreviewToken);
    assert.ok(utf8.data.buckets && utf8.data.buckets.recommended.length);
    assert.strictEqual(utf8.data.profile.studentIdMasked, "2025****0303");
    assert.ok(!JSON.stringify(utf8.data).includes("password"));
    const confirmed = confirmStudentScheduleImport({
      fosuSession: { openidHash: session.payload && session.payload.openidHash },
    }, {
      importPreviewToken: utf8.data.importPreviewToken,
      mode: "replace_fosu_source",
      selectedArrangementIds: utf8.data.defaultSelectedArrangementIds,
    });
    assert.strictEqual(confirmed.success, true);
    assert.ok(confirmed.schedule.courses.length);
    assert.strictEqual(confirmed.schedule.source, "client-direct");
    assert.ok(confirmed.recentImport);

    const gbkHtml = HTML.replace("charset=\"utf-8\"", "charset=gbk");
    const gbk = await requestJson(baseUrl, "/api/schedule-import/fosu/direct/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "client-direct-fosu100",
        timetableBodyBase64: iconv.encode(gbkHtml, "gbk").toString("base64"),
        contentType: "text/html; charset=gbk",
        semester: "2025-2026-2",
      }),
    });
    assert.strictEqual(gbk.status, 200);
    assert.ok(gbk.data.summary.rawRowCount >= 1);
    assert.ok(logs.join("\n").includes("DIRECT_SECRET_REJECTED"));
    assert.ok(!logs.join("\n").includes(Buffer.from(HTML).toString("base64").slice(0, 40)));
    console.log = original;
    console.log("test-fosu-direct-preview-route passed");
  } finally {
    console.log = original;
    server.close();
    fs.rmSync(process.env.FOSU_RECENT_IMPORT_STORE_FILE, { force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
