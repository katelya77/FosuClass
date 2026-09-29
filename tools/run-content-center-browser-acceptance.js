#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("./fosu-sync-client/node_modules/playwright");
const { DAILY_KNOWLEDGE_BINDINGS, DAILY_KNOWLEDGE_SCRIPT, DAILY_KNOWLEDGE_SECTION, DAILY_KNOWLEDGE_STYLES } = require("../server/src/routes/adminDailyKnowledgeAssets");

const out = path.resolve("output/content-center-acceptance");
fs.mkdirSync(out, { recursive: true });

function seed(mode) {
  const now = "2026-09-29T08:00:00.000Z";
  const notice = (id, title, priority = "normal") => ({ id, title, content: "学校服务安排以正式通知为准。", type: "info", priority, displayMode: "ticker", targetPage: "home", enabled: true, closable: true, version: "v-" + id, createdAt: now, updatedAt: now });
  return {
    notices: mode === "empty" ? [] : mode === "many" ? Array.from({ length: 13 }, (_, i) => notice("n" + i, "校园公告 " + (i + 1))) : [notice("n1", mode === "long" ? "关于图书馆国庆节期间开放时间与自习室预约安排调整的重要通知" : "图书馆国庆开放时间调整", mode === "urgent" ? "urgent" : (mode === "important" ? "important" : "normal"))],
    dailyKnowledge: {
      policy: { enabled: mode !== "paused" && mode !== "empty", strategy: "balanced", rotationOffset: 0 },
      policyVersion: "p1",
      selected: mode === "paused" || mode === "empty" ? null : { id: "tip1", title: "防诈小知识", content: "涉及转账时请先核实身份，任何验证码都不要交给他人。", category: "fraud", type: "warning" },
      managed: [], builtin: [], counts: { managed: 0, managedActive: 0, active: mode === "paused" ? 0 : 1, total: 1, builtin: 1 },
      cloudbase: { count: 1, source: "builtin", contentVersion: "test", permission: "READONLY", mirror: { status: mode === "pending" ? "pending" : "synced" } },
    },
    contentCenter: { modules: { announcements: { enabled: true, version: "v1" }, dailyKnowledge: { enabled: mode !== "paused", version: "p1" } }, mirror: { status: mode === "pending" ? "pending" : "synced" } },
  };
}

function html(data, theme) {
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>
  :root { --surface:#fff;--surface-muted:#f5f6f8;--border:#e2e6ea;--brand-soft:#fff3f2;--text-secondary:#5f6a78;--text-muted:#7d8793;--knowledge-red:#c83a32; }
  html[data-theme="dark"] { --surface:#1d232b;--surface-muted:#151a21;--border:#3a444f;--brand-soft:#402421;--text-secondary:#bdc6d0;--text-muted:#a0abb6;--knowledge-red:#e37269;color-scheme:dark; }
  * { box-sizing:border-box; } body { margin:0;padding:24px;background:var(--surface-muted);color:var(--text-secondary);font:14px/1.5 "Microsoft YaHei",sans-serif; }
  .section { max-width:1600px;margin:auto; }.card,.preview-box { padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface); }
  input,select,textarea,button { max-width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:inherit;font:inherit; }
  input,select,textarea { width:100%; } button { cursor:pointer; } button.primary { background:#c83a32;color:white;border-color:#c83a32; }
  .preview-phone { margin-top:12px;padding:10px;border:5px solid #29313b;border-radius:23px;background:#f5f6f8;aspect-ratio:9/18; }
  .phone-bar { display:flex;justify-content:space-between;font-size:9px;color:#1d2731; }.phone-screen { padding-top:12px; }
  ${DAILY_KNOWLEDGE_STYLES}
  </style></head><body>${DAILY_KNOWLEDGE_SECTION}<script>
  var state=${JSON.stringify(data)};
  function $(id){return document.getElementById(id);} function value(id){var el=$(id);return el?el.value.trim():"";}
  function setValue(id,v){var el=$(id);if(el)el.value=v==null?"":String(v);}
  function boolValue(id){return value(id)==="true";}
  function escapeHtml(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}[ch];});}
  function safeBind(id,event,fn){var el=$(id);if(el)el.addEventListener(event,fn);}
  function showToast(message){window.__toast=message;} function formatDate(s){return String(s||"").slice(0,16);}
  function api(url,options){options=options||{};var method=options.method||"GET",body=options.body?JSON.parse(options.body):{};
    if(url==="/api/admin/content-center"&&method==="GET")return Promise.resolve({data:state.contentCenter});
    if(url==="/api/admin/notices"&&method==="GET")return Promise.resolve({items:state.notices});
    if(url==="/api/admin/daily-knowledge"&&method==="GET")return Promise.resolve({data:state.dailyKnowledge});
    if(url==="/api/admin/notices"&&method==="POST"){state.notices.unshift(Object.assign({id:"created",version:"v-created",updatedAt:new Date().toISOString()},body));return Promise.resolve({success:true});}
    if(url.indexOf("/api/admin/notices/")===0&&method==="PUT"){var id=decodeURIComponent(url.split("/").pop()),item=state.notices.find(function(x){return x.id===id;});Object.assign(item,body,{version:"next"});return Promise.resolve({success:true});}
    if(url.indexOf("/api/admin/notices/")===0&&method==="DELETE"){var id=decodeURIComponent(url.split("/").pop());state.notices=state.notices.filter(function(x){return x.id!==id;});return Promise.resolve({success:true});}
    if(url==="/api/admin/content-center/policy"&&method==="PUT"){state.contentCenter.modules.announcements={enabled:body.announcementsEnabled,version:"v2"};return Promise.resolve({success:true});}
    if(url==="/api/admin/daily-knowledge/policy"&&method==="POST"){state.dailyKnowledge.policy=Object.assign({},state.dailyKnowledge.policy,body);state.dailyKnowledge.selected=body.enabled?{title:"防诈小知识",content:"核实身份",category:"fraud"}:null;state.dailyKnowledge.cloudbase.mirror.status="pending";return Promise.resolve({success:true});}
    return Promise.resolve({data:{}});
  }
  function loadNotices(){return api("/api/admin/notices").then(function(r){state.notices=r.items;renderContentAnnouncements();});}
  function loadDailyKnowledge(){return api("/api/admin/daily-knowledge").then(function(r){state.dailyKnowledge=r.data;renderDailyKnowledge();});}
  function ignoreLoadError(p){return p.catch(function(){});}
  ${DAILY_KNOWLEDGE_SCRIPT}
  ${DAILY_KNOWLEDGE_BINDINGS}
  contentCenterResetNotice();renderContentAnnouncements();renderDailyKnowledge();renderContentCenterOverview();
  </script></body></html>`;
}

async function run() {
  const browserRoot = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const installed = fs.existsSync(browserRoot) ? fs.readdirSync(browserRoot)
    .filter((name) => name.startsWith("chromium_headless_shell-"))
    .sort().reverse()
    .map((name) => path.join(browserRoot, name, "chrome-headless-shell-win64", "chrome-headless-shell.exe"))
    .find((candidate) => fs.existsSync(candidate)) : "";
  const browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: installed } : {}) });
  try {
    for (const [mode, width, theme] of [
      ["empty", 1920, "light"], ["normal", 1366, "light"], ["many", 1366, "light"],
      ["paused", 1366, "light"], ["pending", 1366, "light"], ["important", 740, "light"],
      ["urgent", 740, "light"], ["long", 740, "light"], ["normal", 1366, "dark"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent(html(seed(mode), theme), { waitUntil: "load" });
      assert.deepStrictEqual(errors, [], `${mode}: page scripts should run`);
      assert(await page.locator("#contentCenterNoticeList").count());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert(!overflow, `${mode}/${width}: no horizontal page overflow`);
      if (["normal", "important", "urgent", "long"].includes(mode)) {
        const layout = await page.locator("#contentCenterPhoneScreen").evaluate((screen) => {
          const home = screen.querySelector(".content-center-phone-home").getBoundingClientRect();
          const tickerNode = screen.querySelector(".content-center-phone-ticker");
          const ticker = tickerNode.getBoundingClientRect();
          const next = tickerNode.nextElementSibling.getBoundingClientRect();
          const close = screen.querySelector(".content-center-phone-ticker-close").getBoundingClientRect();
          return { above: ticker.top - home.bottom, below: next.top - ticker.bottom, closeWidth: close.width, tickerWidth: ticker.width, screenWidth: screen.getBoundingClientRect().width };
        });
        assert(Math.abs(layout.above - layout.below) <= 1, `${mode}: announcement spacing should match above and below`);
        assert(layout.closeWidth <= 24, `${mode}: close affordance should stay compact`);
        assert(layout.tickerWidth <= layout.screenWidth + 1, `${mode}: ticker should fit phone width`);
      }
      if (mode === "paused") assert.strictEqual(await page.locator("#contentCenterPhoneScreen .knowledge-preview-card").count(), 0);
      if (mode === "pending") assert.match(await page.locator("#dailyKnowledgeCloudbaseStatus").textContent(), /镜像状态落后/);
      if (mode === "many") assert.match(await page.locator("#contentCenterNoticePageSummary").textContent(), /第 1 \/ 2 页/);
      await page.screenshot({ path: path.join(out, `${mode}-${width}-${theme}.png`), fullPage: true });
      if (mode === "normal" && theme === "light") {
        await page.locator(".content-center-announcement-grid .preview-phone").screenshot({ path: path.join(out, "notice-phone-preview.png") });
      }
      if (mode === "normal" && theme === "light") {
        await page.locator("#contentCenterNoticeTitle").fill("校园服务临时调整");
        await page.locator("#contentCenterNoticeContent").fill("请留意开放时间。");
        assert.match(await page.locator("#contentCenterPhoneScreen").textContent(), /校园服务临时调整/);
        await page.locator("#contentCenterNoticeSave").click();
        await page.waitForFunction(() => document.getElementById("contentCenterNoticeSaveState").textContent.includes("已保存"));
        assert.match(await page.locator("#contentCenterNoticeList").textContent(), /校园服务临时调整/);
        await page.locator("#dailyKnowledgePolicyEnabled").selectOption("false");
        assert.strictEqual(await page.locator("#contentCenterPhoneScreen .knowledge-preview-card").count(), 0);
        await page.locator("#contentCenterNoticeList .actions button").first().click();
        assert.match(await page.locator("#contentCenterNoticeFormTitle").textContent(), /编辑公告/);
        page.on("dialog", (dialog) => dialog.accept());
        await page.locator("#contentCenterNoticeList .actions button.danger").first().click();
        await page.waitForTimeout(30);
      }
      await page.close();
    }
    console.log("content-center browser acceptance passed: 9 viewport/state combinations and interactive form checks");
  } finally { await browser.close(); }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
