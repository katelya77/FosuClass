#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const vm = require("vm");

const storage = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-content-center-"));
process.env.FOSU_STORAGE_DIR = storage;
const service = require("../server/src/services/appConfigService");

try {
  const original = service.getPublicAppConfig().data;
  assert(original.dailyKnowledge && original.dailyKnowledge.content);

  service.saveDailyKnowledgePolicy({ enabled: false, strategy: "balanced", rotationOffset: 0 });
  const mirrorService = require("../server/src/services/dailyKnowledgeCloudbaseService");
  const queued = mirrorService.queueSync();
  assert.strictEqual(queued.status, "pending", "A18: a disabled/unavailable mirror must remain pending");
  const paused = service.getPublicAppConfig().data;
  assert.strictEqual(paused.dailyKnowledge, null, "A1: public dailyKnowledge must be null after pause");
  assert.strictEqual(paused.contentModules.dailyKnowledge.enabled, false);
  assert(paused.contentModules.dailyKnowledge.version);
  assert.strictEqual(mirrorService.getMirrorStatus().status, "pending");

  const restored = service.saveDailyKnowledgePolicy({ enabled: true, strategy: "sequential", rotationOffset: 1 });
  assert.strictEqual(restored.enabled, true);
  assert(service.getPublicAppConfig().data.dailyKnowledge, "A5: resume must select a daily item");

  const ticker = service.createNoticeOperation({
    title: "图书馆开放时间调整",
    content: "请查看图书馆发布的最新开放安排。",
    type: "info", priority: "important", displayMode: "ticker", targetPage: "home",
    enabled: true, closable: true,
  }, { idempotencyKey: "content-center-test-ticker" }).item;
  assert(service.getPublicAppConfig().data.notices.some((item) => item.id === ticker.id), "A7: ticker should enter public app-config");

  const stopped = service.updateNotice(ticker.id, { enabled: false }, { expectedVersion: ticker.version });
  assert(!service.getPublicAppConfig().data.notices.some((item) => item.id === ticker.id), "A8: stopped ticker must disappear");
  const resumed = service.updateNotice(ticker.id, { enabled: true }, { expectedVersion: stopped.version });

  const future = service.createNotice({ title: "未来公告", content: "尚未开始", displayMode: "ticker", targetPage: "home", enabled: true, startAt: "2099-01-01T00:00:00.000Z" });
  const expired = service.createNotice({ title: "过期公告", content: "已经结束", displayMode: "ticker", targetPage: "home", enabled: true, endAt: "2000-01-01T00:00:00.000Z" });
  const publicIds = service.getPublicAppConfig().data.notices.map((item) => item.id);
  assert(!publicIds.includes(future.id), "A9: future notice must remain hidden");
  assert(!publicIds.includes(expired.id), "A10: expired notice must remain hidden");
  assert(publicIds.includes(resumed.id));

  service.saveAnnouncementsPolicy(false);
  const announcementsOff = service.getPublicAppConfig().data;
  assert.strictEqual(announcementsOff.contentModules.announcements.enabled, false);
  assert(!announcementsOff.notices.some((item) => item.id === ticker.id), "announcement switch must not affect daily knowledge");
  assert(announcementsOff.dailyKnowledge);
  service.saveDailyKnowledgePolicy({ enabled: false });
  const allOff = service.getPublicAppConfig().data;
  assert.strictEqual(allOff.dailyKnowledge, null, "A17: both modules can be off independently");
  assert(!allOff.notices.some((item) => item.id === ticker.id));

  assert.throws(() => service.createNotice({ title: "<script>alert(1)</script>", content: "unsafe" }), /纯文本/);
  assert.throws(() => service.createNotice({ title: "普通公告", content: "javascript:alert(1)" }), /纯文本/);
  const previousVersion = resumed.version;
  assert.throws(() => service.updateNotice(ticker.id, { title: "冲突" }, { expectedVersion: "old" }), /modified/);
  assert.throws(() => service.deleteNotice(ticker.id, { expectedVersion: "old" }), /modified/);
  assert(service.listNotices().some((item) => item.id === ticker.id && item.version === previousVersion));

  const child = spawnSync(process.execPath, ["-e", "const s=require('./server/src/services/appConfigService');const c=s.getPublicAppConfig().data;process.stdout.write(JSON.stringify({daily:c.dailyKnowledge,announcements:c.contentModules.announcements.enabled,hasNotice:s.listNotices().some(x=>x.title==='图书馆开放时间调整')}))"], {
    cwd: path.resolve(__dirname, ".."), env: { ...process.env, FOSU_STORAGE_DIR: storage }, encoding: "utf8",
  });
  assert.strictEqual(child.status, 0, child.stderr);
  const afterRestart = JSON.parse(child.stdout);
  assert.strictEqual(afterRestart.daily, null, "A19: pause survives process restart");
  assert.strictEqual(afterRestart.announcements, false);
  assert.strictEqual(afterRestart.hasNotice, true, "A19: notices survive process restart");

  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/deploy-vps.yml"), "utf8");
  const compose = fs.readFileSync(path.join(__dirname, "..", "server/docker-compose.yml"), "utf8");
  assert(workflow.includes("!server/storage/**") && compose.includes("./storage:/app/storage"), "A20: deployment must preserve production storage");

  const html = require("../server/src/routes/adminPages").adminConsoleHtml;
  const scripts = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g));
  scripts.forEach((match) => new vm.Script(match[1]));
  assert(html.includes("首页内容") && html.includes("公告播报") && html.includes("手机实时预览"));
  console.log(`test-content-center passed (${scripts.length} inline scripts parsed)`);
} finally {
  const resolved = path.resolve(storage);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
}
