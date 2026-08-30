/**
 * Service-level write parity: content domain service mirrors appConfigService results.
 * (HTTP Legacy vs Vue both hit the same handlers → same service.)
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-write-parity-"));
process.env.FOSU_STORAGE_DIR = path.join(tmpRoot, "storage");
fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });

for (const key of Object.keys(require.cache)) {
  if (key.includes("appConfigService") || key.includes(`${path.sep}content${path.sep}service`)) {
    delete require.cache[key];
  }
}

const appConfigService = require("../server/src/services/appConfigService");
const contentService = require("../server/src/modules/content/service");

const viaDomain = contentService.createNotice({ title: "parity-a", content: "x", enabled: true });
const dailyTip = contentService.createNotice({
  title: "防诈小知识",
  content: "不要向陌生人提供验证码。",
  category: "fraud",
  displayMode: "daily-tip",
  targetPage: "all",
  enabled: true,
}, { idempotencyKey: "daily-tip-create-1" });
assert.strictEqual(dailyTip.targetPage, "home", "daily knowledge is always scoped to the home page");
assert.strictEqual(dailyTip.category, "fraud", "daily knowledge category is persisted");
const replayedDailyTip = contentService.createNotice({
  title: "防诈小知识",
  content: "不要向陌生人提供验证码。",
  category: "fraud",
  displayMode: "daily-tip",
  targetPage: "all",
  enabled: true,
}, { idempotencyKey: "daily-tip-create-1" });
assert.strictEqual(replayedDailyTip.id, dailyTip.id, "same idempotency key replays the existing notice");
assert.strictEqual(contentService.listNotices().filter((item) => item.id === dailyTip.id).length, 1);
assert.throws(() => contentService.createNotice({
  title: "不同正文",
  content: "不同内容",
  category: "campus",
  displayMode: "daily-tip",
  enabled: true,
}, { idempotencyKey: "daily-tip-create-1" }), (error) => error && error.code === "IDEMPOTENCY_KEY_CONFLICT");
const storedNotices = JSON.parse(fs.readFileSync(contentService.NOTICES_PATH, "utf8"));
storedNotices.push({
  id: "legacy-daily-tip-wrong-target",
  title: "旧异常数据",
  content: "不应计入首页内容池",
  category: "campus",
  type: "info",
  priority: "normal",
  displayMode: "daily-tip",
  targetPage: "today",
  enabled: true,
  closable: false,
  version: "legacy-v1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});
fs.writeFileSync(contentService.NOTICES_PATH, JSON.stringify(storedNotices, null, 2), "utf8");
const selectedTip = appConfigService.selectDailyKnowledge(contentService.listNotices(), new Date("2026-08-29T00:00:00+08:00"));
assert.strictEqual(selectedTip.source, "managed");
assert.strictEqual(selectedTip.id, dailyTip.id);
assert.strictEqual(selectedTip.category, "fraud");
const dailyAdminState = contentService.getDailyKnowledgeAdminState(new Date("2026-08-29T00:00:00+08:00"));
assert.strictEqual(dailyAdminState.mode, "managed");
assert.strictEqual(dailyAdminState.counts.managed, 1);
assert.strictEqual(dailyAdminState.counts.active, 1);
assert.ok(dailyAdminState.counts.builtin >= 8);
assert.ok(dailyAdminState.builtin.every((item) => item.source === "builtin"));
const listedDirect = appConfigService.listNotices();
const listedDomain = contentService.listNotices();
assert.strictEqual(listedDirect.length, listedDomain.length);
assert.ok(listedDirect.some((n) => n.id === viaDomain.id));
assert.ok(listedDomain.some((n) => n.id === viaDomain.id));

const updated = contentService.updateNotice(viaDomain.id, { title: "parity-b" }, { expectedVersion: viaDomain.version });
assert.strictEqual(updated.title, "parity-b");
assert.strictEqual(appConfigService.listNotices().find((n) => n.id === viaDomain.id).title, "parity-b");

contentService.deleteNotice(viaDomain.id);
assert.strictEqual(appConfigService.listNotices().some((n) => n.id === viaDomain.id), false);

contentService.deleteNotice(dailyTip.id);
const fallbackDailyState = contentService.getDailyKnowledgeAdminState(new Date("2026-08-29T00:00:00+08:00"));
assert.strictEqual(fallbackDailyState.mode, "builtin");
assert.strictEqual(fallbackDailyState.selected.source, "builtin");
const replayAfterDelete = contentService.createNotice({
  title: "防诈小知识",
  content: "不要向陌生人提供验证码。",
  category: "fraud",
  displayMode: "daily-tip",
  targetPage: "all",
  enabled: true,
}, { idempotencyKey: "daily-tip-create-1" });
assert.strictEqual(replayAfterDelete.id, dailyTip.id, "deleted operation replays its original receipt");
assert.strictEqual(contentService.listNotices().some((item) => item.id === dailyTip.id), false, "replay must not resurrect deleted content");
assert.ok(fs.existsSync(contentService.NOTICE_IDEMPOTENCY_PATH), "idempotency ledger must persist separately");

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("Admin write parity tests passed.");
