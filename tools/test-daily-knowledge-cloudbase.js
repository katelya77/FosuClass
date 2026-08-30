#!/usr/bin/env node
"use strict";

const assert = require("assert");
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

const managedDeployment = buildDeployment({
  managed: [
    { id: "managed_a", category: "mind", title: "心理小知识", content: "后台内容 A", type: "success" },
    { id: "managed_b", category: "fraud", title: "防诈小知识", content: "后台内容 B", type: "warning" },
  ],
  builtin,
}, new Date("2026-08-31T00:00:00.000Z"));
assert.strictEqual(managedDeployment.count, 362);
assert.strictEqual(managedDeployment.rotationCount, 2, "managed items must take rotation priority");
assert.strictEqual(managedDeployment.documents[0].source, "managed");
assert.strictEqual(managedDeployment.documents[2].source, "builtin");

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
};

global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
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

  storage.clear();
  const changedFallback = Object.assign({}, fallback, { content: "服务端已更新但云端尚未同步。" });
  const fallbackResult = await service.loadDailyKnowledge({ fallback: changedFallback, now: new Date("2026-09-01T08:00:00.000Z") });
  assert.strictEqual(fallbackResult.content, changedFallback.content, "server result must remain the last-known-good fallback");
  console.log("test-daily-knowledge-cloudbase passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
