"use strict";

const crypto = require("crypto");
const builtin = require("./dailyKnowledgeBuiltin");
const dailyKnowledgePolicy = require("./dailyKnowledgePolicy");

const REGISTRY_COLLECTION = "fosu_daily_knowledge_registry";
const ACTIVE_DOCUMENT_ID = "active";
const CONTENT_COLLECTION_PREFIX = "fosu_daily_knowledge_v1_";

function normalizePools(source) {
  if (source && !Array.isArray(source) && typeof source === "object") {
    return {
      managed: Array.isArray(source.managed) ? source.managed : [],
      builtin: Array.isArray(source.builtin) ? source.builtin : builtin,
      policy: dailyKnowledgePolicy.normalizePolicy(source.policy),
    };
  }
  return { managed: [], builtin: Array.isArray(source) ? source : builtin, policy: dailyKnowledgePolicy.normalizePolicy() };
}

function stablePayload(source = builtin) {
  const pools = normalizePools(source);
  const resolved = dailyKnowledgePolicy.resolvePool({
    managed: pools.managed,
    builtin: pools.builtin,
    policy: pools.policy,
    now: source && source.now instanceof Date ? source.now : new Date(),
  });
  return resolved.items.map((item) => Object.assign({ source: resolved.source }, item))
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
  const resolved = dailyKnowledgePolicy.resolvePool({ managed: pools.managed, builtin: pools.builtin, policy: pools.policy, now });
  const payload = resolved.items.map((item) => ({
    sourceId: item.id,
    source: resolved.source,
    category: dailyKnowledgePolicy.categoryFor(item),
    title: item.title,
    content: item.content,
    type: item.type,
    enabled: true,
  }));
  const version = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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
    enabled: pools.policy.enabled,
    strategy: pools.policy.strategy,
    source: resolved.source,
    managedCount: resolved.source === "managed" ? payload.length : 0,
    builtinCount: resolved.source === "builtin" ? payload.length : 0,
    rotationOffset: pools.policy.rotationOffset % Math.max(1, payload.length),
    rotationCount: payload.length,
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
