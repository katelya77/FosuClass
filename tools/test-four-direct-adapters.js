"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { chromium } = require("./fosu-sync-client/node_modules/playwright");
const { buildSyncPlan } = require("../shared/syncPlan");
const html = "<table id='kbtable'><tr><td>班级</td><td>星期一</td></tr><tr><td>节次</td><td>[1-2]</td></tr><tr><td>26测试1班</td><td>测试课程<br>测试教师<br>1-2周<br>B1-101[1-2]节<br>26测试1班</td></tr></table>";
async function main() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      requests.push({ path: req.url, method: req.method, body: new URLSearchParams(body) });
      res.end(html); return;
    }
    const kind = /teacher/.test(req.url) ? "teacher" : /classroom/.test(req.url) ? "roomid" : "kcid";
    res.end("<select name='xnxqh'><option value='2026-2027-1'>2026-2027-1</option></select><select name='" + kind + "'><option value='fixture-one'>测试" + kind + "</option></select>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.FOSU_COLLECTOR_MODE = "1";
  process.env.FOSU_SYNC_FIXTURE_ONLY = "1"; // HTTP is permitted only on 127.0.0.1, never a school host.
  process.env.FOSU_BASE_URL = "http://127.0.0.1:" + server.address().port;
  process.env.FOSU_SYNC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-adapters-"));
  global.SYNC_PLAN = buildSyncPlan("crawl:daily", { term: "2026-2027-1", "run-id": "fixture-direct", "allow-derived": false }, {});
  global.CLI_PARAMS = {};
  const sync = require("./fosu-sync-client/sync");
  let browser;
  try {
    try { browser = await chromium.launch({ headless: true, channel: "msedge" }); }
    catch (_) { browser = await chromium.launch({ headless: true }); }
    const page = await browser.newPage();
    const classes = await sync.crawlStrictClassSchedules(page, { colleges: [{ code: "fixture-college", name: "测试学院" }], grades: ["2026"] }, [{ collegeCode: "fixture-college", grade: "2026", code: "fixture-major", name: "测试专业" }]);
    assert.equal(classes.filter((item) => item.className === "26测试1班").length, 1, "the administrative class from the school row must remain distinct from any auxiliary major document");
    const resources = await sync.crawlStrictResources(page, ["teacher", "classroom", "course"], "2026-2027-1");
    for (const kind of ["teacher", "classroom", "course"]) { assert.equal(resources[kind + "Schedules"].length, 1); assert.equal(global.DIRECT_SOURCE_SUMMARY[kind].sourceMode, "network-direct"); }
    assert.deepEqual(requests.map((item) => item.path), ["/kbcx/kbxx_xzb_ifr", "/kbcx/kbxx_teacher_ifr", "/kbcx/kbxx_classroom_ifr", "/kbcx/kbxx_kc_ifr"]);
    assert.equal(requests[0].body.get("skzy"), "fixture-major");
    for (let index = 1; index < requests.length; index++) { assert.equal(requests[index].body.get(["", "teacher", "roomid", "kcid"][index]), "fixture-one"); assert.equal(requests[index].body.get("xnxqh"), "2026-2027-1"); }
    assert.equal(JSON.stringify(resources).includes("rawHtml"), false);
    await sync.crawlStrictResources(page, ["teacher", "classroom", "course"], "2026-2027-1");
    assert.equal(requests.length, 4, "resume must reuse only this run's successful entity checkpoint");
    console.log("four-direct-adapters: PASS (headless browser + local HTTP fixtures; four real adapter paths, no school traffic)");
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
