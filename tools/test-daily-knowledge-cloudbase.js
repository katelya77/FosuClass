#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const builtin = require("../server/src/content/dailyKnowledgeBuiltin");
const { buildDeployment } = require("../server/src/content/dailyKnowledgeCloudbaseData");
const serverAppConfigService = require("../server/src/services/appConfigService");

const first = buildDeployment(builtin, new Date("2026-08-31T00:00:00.000Z"));
const repeated = buildDeployment(builtin, new Date("2026-09-01T00:00:00.000Z"));
assert.strictEqual(first.count, 360);
assert.strictEqual(first.managedCount, 0);
assert.strictEqual(first.builtinCount, 360);
assert.strictEqual(first.rotationCount, 360);
assert.strictEqual(first.collectionName, repeated.collectionName, "collection name must be content-addressed");
assert.strictEqual(new Set(first.documents.map((item) => item._id)).size, first.documents.length);

const syncScript = fs.readFileSync(path.join(__dirname, "cloudbase", "sync-daily-knowledge.js"), "utf8");
assert.ok(
  syncScript.includes("const batch = documents.slice(offset, offset + BATCH_SIZE);"),
  "CloudBase MCP insert payload must remain an object array"
);
assert.ok(
  syncScript.includes("const missingDocuments = deployment.documents.filter"),
  "a failed partial upload must resume by inserting only missing documents"
);
assert.ok(
  syncScript.includes("item.TableName || item.Name"),
  "CloudBase collection listings must recognize the MCP TableName field"
);

const managedDeployment = buildDeployment({
  managed: [
    { id: "managed_a", category: "mind", title: "心理小知识", content: "后台内容 A", type: "success", enabled: true, displayMode: "daily-tip", targetPage: "home" },
    { id: "managed_b", category: "fraud", title: "防诈小知识", content: "后台内容 B", type: "warning", enabled: true, displayMode: "daily-tip", targetPage: "home" },
  ],
  builtin,
}, new Date("2026-08-31T00:00:00.000Z"));
assert.strictEqual(managedDeployment.count, 2, "CloudBase must publish only the effective managed pool");
assert.strictEqual(managedDeployment.rotationCount, 2, "managed items must take rotation priority");
assert.strictEqual(managedDeployment.documents[0].source, "managed");
assert.strictEqual(managedDeployment.builtinCount, 0, "fallback items must not duplicate the effective pool");

const storage = new Map();
let requestedDocumentId = "";
const now = new Date("2026-08-31T08:00:00.000Z");
const selectedSlot = Math.floor(Date.parse("2026-08-31T00:00:00Z") / 86400000) % first.rotationCount;
const selectedDocument = first.documents[selectedSlot];
assert.strictEqual(
  serverAppConfigService.selectDailyKnowledge([], now).id,
  selectedDocument.sourceId,
  "server and CloudBase clients must select the same daily slot"
);
const registry = {
  activeCollection: first.collectionName,
  count: first.count,
  rotationOffset: 0,
  rotationCount: first.rotationCount,
  contentVersion: first.contentVersion,
  enabled: true,
  strategy: "balanced",
};

global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
  cloud: {
    database() {
      return {
        collection(name) {
          return {
            doc(id) {
              return {
                get() {
                  if (name === "fosu_daily_knowledge_registry" && id === "active") {
                    return Promise.resolve({ data: registry });
                  }
                  requestedDocumentId = id;
                  return Promise.resolve({ data: selectedDocument });
                },
              };
            },
          };
        },
      };
    },
  },
};

const service = require("../miniprogram/services/dailyKnowledgeCloudService");

(async () => {
  const fallback = { id: selectedDocument.sourceId, title: selectedDocument.title, content: selectedDocument.content, category: selectedDocument.category, type: selectedDocument.type, date: "2026-08-31" };
  const cloudItem = await service.loadDailyKnowledge({ fallback, now });
  assert.strictEqual(cloudItem.source, "cloudbase");
  assert.strictEqual(cloudItem.content, selectedDocument.content);
  assert.strictEqual(requestedDocumentId, service.slotDocumentId(service.slotForDate("2026-08-31", 360)));

  global.wx.cloud.database = () => { throw new Error("offline"); };
  const cached = await service.loadDailyKnowledge({ fallback, now });
  assert.strictEqual(cached.source, "cloudbase", "same-day local cache should survive CloudBase failure");

  const disabledPolicy = { enabled: false, version: "policy-paused" };
  const pausedOffline = await service.loadDailyKnowledge({ fallback: null, now, serverPolicy: disabledPolicy });
  assert.strictEqual(pausedOffline, null, "Server pause must win even when CloudBase is offline");
  assert.strictEqual(storage.has(service.CACHE_KEY), false, "Server pause must clear the cached item");

  storage.clear();
  const changedFallback = Object.assign({}, fallback, { content: "服务端已更新但云端尚未同步。" });
  const fallbackResult = await service.loadDailyKnowledge({ fallback: changedFallback, now: new Date("2026-09-01T08:00:00.000Z") });
  assert.strictEqual(fallbackResult.content, changedFallback.content, "server result must remain the last-known-good fallback");

  registry.enabled = false;
  global.wx.cloud.database = () => ({
    collection() {
      return { doc() { return { get() { return Promise.resolve({ data: registry }); } }; } };
    },
  });
  const disabled = await service.loadDailyKnowledge({ fallback, now, serverPolicy: { enabled: true, version: "policy-running" } });
  assert.strictEqual(disabled.content, fallback.content, "Server fallback must survive a disabled mirror");

  registry.enabled = true;
  storage.set(service.CACHE_KEY, { date: "2026-08-31", policyVersion: "old", item: fallback });
  const pausedOnline = await service.loadDailyKnowledge({ fallback: null, now, serverPolicy: disabledPolicy });
  assert.strictEqual(pausedOnline, null, "Server pause must override an enabled CloudBase registry");
  assert.strictEqual(storage.has(service.CACHE_KEY), false, "Server pause must remove stale local cache");

  const clientConfig = require("../miniprogram/services/appConfigService");
  const request = require("../miniprogram/utils/request");
  const originalGet = request.get;
  storage.set(clientConfig.APP_CONFIG_CACHE_KEY, {
    config: { dailyKnowledge: fallback, notices: [{ id: "stale", title: "旧公告", targetPage: "home" }] },
  });
  request.get = () => Promise.reject(new Error("offline"));
  try {
    const stale = await clientConfig.loadAppConfig({ force: true, requireFreshContent: true, silent: true });
    assert.strictEqual(stale.dailyKnowledge, null, "stale app-config must not revive the daily card");
    assert.strictEqual(stale.contentModules.dailyKnowledge.enabled, false);
    assert.deepStrictEqual(stale.notices, [], "stale app-config must not revive announcements");
  } finally {
    request.get = originalGet;
  }
  console.log("test-daily-knowledge-cloudbase passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
