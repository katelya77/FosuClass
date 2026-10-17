"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http"), dgram = require("node:dgram");
const { chromium } = require("./fosu-sync-client/node_modules/playwright");
const diagnostic = require("../deploy/collector-closure/resource-page-diagnostic");
const ledgerModule = require("./wyz-schedule-collector/requestLedger");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-resource-probe-"));
let server, browser, udp, scenario = "normal", received = [], cases = 0;
const classify = body => /统一身份认证|密码登录/.test(body) ? "SCHOOL_SESSION_EXPIRED" : /安全验证/.test(body) ? "SCHOOL_SECURITY_CHALLENGE" : /没有权限/.test(body) ? "SCHOOL_ACCESS_DENIED" : null;
(async () => {
  udp = dgram.createSocket("udp4"); await new Promise(resolve => udp.bind(0, "127.0.0.1", resolve));
  udp.on("message", message => received.push(["UDP", message.length]));
  server = http.createServer((req, res) => {
    received.push([req.method, req.url]);
    if (req.url === "/assets/page.js") { res.setHeader("content-type", "application/javascript"); res.end("/*fixture*/"); return; }
    if (scenario === "status-403" || scenario === "status-429") res.statusCode = Number(scenario.slice(7));
    res.setHeader("content-type", "text/html; charset=utf-8");
    let html = "<select name='xnxqh'>"+(scenario === "term-post" ? "<option value='2025-2026-2'>旧学期</option>" : "")+"<option value='2026-2027-1'>2026-2027-1</option></select><input name='jsmc' value='PRIVATE-NAME'><input name='jsid' type='hidden' value='PRIVATE-ID'><input name='token' value='PRIVATE-TOKEN'><input name='account' value='PRIVATE-ACCOUNT'><script src='/assets/page.js'></script>";
    if (scenario === "post") html += "<script>fetch('/kbcx/getTeacherByAjax',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'xnxqh=PRIVATE-TERM&jsid=PRIVATE-ID&token=PRIVATE-TOKEN'}).catch(()=>{})</script>";
    if (scenario === "term-post") html += "<script>document.querySelector('[name=xnxqh]').onchange=()=>fetch('/kbcx/getTeacherByAjax',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'xnxqh=PRIVATE-TERM'}).catch(()=>{})</script>";
    if (scenario === "schedule-script") html += "<script src='/kbcx/kbxx_teacher_ifr'></script>";
    if (scenario === "websocket") html += "<script>new WebSocket('ws://'+location.host+'/kbcx/unapproved_socket')</script>";
    if (scenario === "rtc") html += "<script>try{const p=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:"+udp.address().port+"'}]});p.createDataChannel('fixture');p.createOffer().then(o=>p.setLocalDescription(o)).catch(()=>{})}catch{}</script>";
    if (scenario === "worker") html += "<script>try{new Worker('/assets/page.js')}catch{}</script>";
    if (scenario === "login") html = "统一身份认证 密码登录";
    if (scenario === "challenge") html = "请完成安全验证";
    if (scenario === "permission") html = "您没有权限访问此页面" + html;
    if (scenario === "password-only") html = "<input type='password' value='PRIVATE-PASSWORD'>";
    if (scenario.startsWith("status-")) html = "HTTP error fixture";
    res.end(html);
  });
  server.on("upgrade", (req, socket) => { received.push(["UPGRADE", req.url]); socket.destroy(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  for (const value of ["normal", "post", "term-post", "schedule-script", "websocket", "rtc", "worker", "login", "password-only", "challenge", "permission", "status-403", "status-429"]) {
    scenario = value; received = []; cases++;
    const context = await browser.newContext({ serviceWorkers: "block" });
    const ledger = ledgerModule.open(path.join(root, "ledger-"+cases+".json"), { runId: "sc-diag-fixture-"+cases, term: "2026-2027-1", workerSourceHash: "a".repeat(64), requestBudget: 40, expiresAt: new Date(Date.now()+60000).toISOString() });
    let queue = Promise.resolve();
    await context.route("**/*", route => {
      assert.equal(new URL(route.request().url()).origin, origin);
      const task = queue.then(async () => {
        const ordinal = ledger.reserve(route.request().method(), route.request().resourceType());
        await route.continue(); const response = await route.request().response();
        assert(response); await response.finished(); ledger.complete(ordinal, response.status());
      });
      queue = task.catch(error => { if (!["SCHOOL_SESSION_EXPIRED", "SCHOOL_RATE_LIMITED"].includes(error.code)) throw error; }); return queue;
    });
    try {
      const codes = { login: "SCHOOL_SESSION_EXPIRED", "password-only": "SCHOOL_SESSION_EXPIRED", challenge: "SCHOOL_SECURITY_CHALLENGE", permission: "SCHOOL_ACCESS_DENIED", "status-403": "SCHOOL_ACCESS_DENIED", "status-429": "SCHOOL_RATE_LIMITED" };
      if (codes[value]) await assert.rejects(diagnostic.observe(context, { origin, classify, settle: () => new Promise(r => setTimeout(r, 50)) }), e => e.code === codes[value]);
      else {
        const result = await diagnostic.observe(context, { origin, classify, settle: () => new Promise(r => setTimeout(r, 50)) });
        const raw = JSON.stringify(result);
        for (const secret of ["PRIVATE-NAME", "PRIVATE-ID", "PRIVATE-PASSWORD", "PRIVATE-ACCOUNT", "PRIVATE-TOKEN", "PRIVATE-TERM"]) assert(!raw.includes(secret));
        assert(result.observations[0].controls.some(c => c.name === "jsmc" && c.type === "text"), "actual text-control identity is retained without its value");
        assert(!result.observations[0].controls.some(c => /password|account/.test(c.name)));
        if (value === "post" || value === "term-post") {
          assert.equal(result.status, "REVIEW_REQUIRED");
          assert(result.blockedRequests.some(r => r.businessPath === "/kbcx/getTeacherByAjax" && r.parameterNames.includes("xnxqh") && !r.parameterNames.includes("token")));
        } else if (["schedule-script", "websocket", "rtc", "worker"].includes(value)) assert.equal(result.status, "REVIEW_REQUIRED");
        else assert.equal(result.status, "OBSERVED");
      }
      await queue;
      assert(!received.some(([method, url]) => method !== "GET" || url.includes("_ifr") || url.includes("ByAjax")), "no timetable/business POST is released");
      assert.equal(ledger.snapshot().pending, false);
      assert(ledger.snapshot().reserved <= 2, "blocked requests do not consume released-request reservations");
    } finally { await context.close(); }
  }
  console.log("collector-resource-diagnostic: PASS; "+cases+" real Chromium scenarios; no school traffic, no POST/IFR released; sanitized controls and request shapes");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); if (udp) await new Promise(resolve => udp.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
});
