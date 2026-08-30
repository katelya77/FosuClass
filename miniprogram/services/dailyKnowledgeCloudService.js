"use strict";

const cloudbaseConfig = require("../config/cloudbase");
const appConfigService = require("./appConfigService");

const CACHE_KEY = "FOSU_DAILY_KNOWLEDGE_CLOUD_CACHE_V1";
const ACTIVE_DOCUMENT_ID = "active";
const COLLECTION_PATTERN = /^fosu_daily_knowledge_v1_[a-z0-9_]{6,40}$/;

function shanghaiDateKey(now) {
  const value = now instanceof Date ? now.getTime() : Number(now);
  const timestamp = Number.isFinite(value) ? value : Date.now();
  return new Date(timestamp + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function slotForDate(dateKey, count) {
  const day = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
  const safeCount = Math.max(1, Number(count) || 1);
  return ((day % safeCount) + safeCount) % safeCount;
}

function slotDocumentId(slot) {
  return `slot_${String(slot).padStart(4, "0")}`;
}

function readCache(dateKey) {
  try {
    const cached = wx.getStorageSync(CACHE_KEY);
    if (cached && cached.date === dateKey && cached.item) {
      return appConfigService.normalizeDailyKnowledge(cached.item);
    }
  } catch (error) {
    // CloudBase is an optional mirror. Invalid cache must not affect the home schedule.
  }
  return null;
}

function writeCache(dateKey, registry, item) {
  try {
    wx.setStorageSync(CACHE_KEY, {
      date: dateKey,
      collection: registry.activeCollection,
      version: registry.contentVersion || "",
      item,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    // Storage pressure should not block the deterministic server fallback.
  }
}

function clearCache() {
  try {
    wx.removeStorageSync(CACHE_KEY);
  } catch (error) {
    // Cache cleanup is best-effort; the authoritative registry still disables display.
  }
}

function normalizeRegistry(payload) {
  const data = payload && payload.data ? payload.data : payload;
  const activeCollection = String(data && data.activeCollection || "").trim();
  const count = Math.max(0, Math.floor(Number(data && data.count) || 0));
  const rotationOffset = Math.max(0, Math.floor(Number(data && data.rotationOffset) || 0));
  const rotationCount = Math.max(0, Math.floor(Number(data && data.rotationCount) || count));
  if (!COLLECTION_PATTERN.test(activeCollection) || count < 1 || count > 1000 ||
      rotationCount < 1 || rotationCount > count || rotationOffset >= rotationCount) {
    return null;
  }
  return {
    activeCollection,
    count,
    rotationOffset,
    rotationCount,
    contentVersion: String(data && data.contentVersion || "").slice(0, 80),
    enabled: data && data.enabled !== false,
    strategy: data && data.strategy === "sequential" ? "sequential" : "balanced",
  };
}

function getDatabase() {
  if (!wx.cloud || typeof wx.cloud.database !== "function") return null;
  try {
    return wx.cloud.database({ env: cloudbaseConfig.ENV_ID });
  } catch (error) {
    return null;
  }
}

function loadDailyKnowledge(options) {
  const opt = Object.assign({ fallback: null, now: new Date() }, options || {});
  const date = shanghaiDateKey(opt.now);
  const fallback = appConfigService.normalizeDailyKnowledge(opt.fallback);
  const cached = readCache(date);
  if (cloudbaseConfig.DAILY_KNOWLEDGE_CLOUDBASE_ENABLED !== true) {
    return Promise.resolve(cached || fallback);
  }
  const db = getDatabase();
  if (!db) return Promise.resolve(cached || fallback);

  return db.collection(cloudbaseConfig.DAILY_KNOWLEDGE_REGISTRY_COLLECTION)
    .doc(ACTIVE_DOCUMENT_ID)
    .get()
    .then((result) => {
      const registry = normalizeRegistry(result);
      if (!registry) throw new Error("DAILY_KNOWLEDGE_REGISTRY_INVALID");
      if (!registry.enabled) {
        clearCache();
        return { registry, item: null, disabled: true };
      }
      const slot = (registry.rotationOffset + slotForDate(date, registry.rotationCount)) % registry.rotationCount;
      return db.collection(registry.activeCollection)
        .doc(slotDocumentId(slot))
        .get()
        .then((itemResult) => ({ registry, item: itemResult && itemResult.data }));
    })
    .then(({ registry, item, disabled }) => {
      if (disabled) return null;
      if (fallback && (
        String(item && item.sourceId || "") !== String(fallback.id || "") ||
        String(item && item.content || "") !== String(fallback.content || "")
      )) {
        return fallback;
      }
      const normalized = appConfigService.normalizeDailyKnowledge(Object.assign({}, item || {}, {
        date,
        source: "cloudbase",
      }));
      if (!normalized) throw new Error("DAILY_KNOWLEDGE_ITEM_INVALID");
      writeCache(date, registry, normalized);
      return normalized;
    })
    .catch(() => cached || fallback);
}

module.exports = {
  ACTIVE_DOCUMENT_ID,
  CACHE_KEY,
  COLLECTION_PATTERN,
  loadDailyKnowledge,
  normalizeRegistry,
  shanghaiDateKey,
  slotDocumentId,
  slotForDate,
};
