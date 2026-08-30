"use strict";

const crypto = require("crypto");
const builtin = require("./dailyKnowledgeBuiltin");

const REGISTRY_COLLECTION = "fosu_daily_knowledge_registry";
const ACTIVE_DOCUMENT_ID = "active";
const CONTENT_COLLECTION_PREFIX = "fosu_daily_knowledge_v1_";

function normalizePools(source) {
  if (source && !Array.isArray(source) && typeof source === "object") {
    return {
      managed: Array.isArray(source.managed) ? source.managed : [],
      builtin: Array.isArray(source.builtin) ? source.builtin : builtin,
    };
  }
  return { managed: [], builtin: Array.isArray(source) ? source : builtin };
}

function stablePayload(source = builtin) {
  const pools = normalizePools(source);
  return pools.managed.map((item) => Object.assign({ source: "managed" }, item))
    .concat(pools.builtin.map((item) => Object.assign({ source: "builtin" }, item)))
    .map((item) => ({
      sourceId: item.id,
      source: item.source,
      category: item.category,
      title: item.title,
      content: item.content,
      type: item.type,
      enabled: true,
    }));
}

function contentVersion(items = builtin) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stablePayload(items)))
    .digest("hex");
}

function buildDeployment(items = builtin, now = new Date()) {
  const pools = normalizePools(items);
  const payload = stablePayload(items);
  const version = contentVersion(items);
  const collectionName = `${CONTENT_COLLECTION_PREFIX}${version.slice(0, 12)}`;
  const publishedAt = now.toISOString();
  const documents = payload.map((item, slot) => Object.assign({
    _id: `slot_${String(slot).padStart(4, "0")}`,
    slot,
    schemaVersion: 1,
    contentVersion: version,
    publishedAt,
  }, item));
  return {
    schemaVersion: 1,
    registryCollection: REGISTRY_COLLECTION,
    activeDocumentId: ACTIVE_DOCUMENT_ID,
    collectionName,
    contentVersion: version,
    count: documents.length,
    managedCount: pools.managed.length,
    builtinCount: pools.builtin.length,
    rotationOffset: 0,
    rotationCount: pools.managed.length || pools.builtin.length,
    publishedAt,
    documents,
  };
}

module.exports = {
  ACTIVE_DOCUMENT_ID,
  CONTENT_COLLECTION_PREFIX,
  REGISTRY_COLLECTION,
  buildDeployment,
  contentVersion,
  stablePayload,
};
