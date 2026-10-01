"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CATALOG, normalizeIds } = require("../content/noticeReactions");
const { SmallJsonCache, writeJsonAtomic } = require("../utils/jsonFileStore");
const ROOT = path.join(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"), "notice-reactions");
const cache = new SmallJsonCache({ maxEntries: 100 });
function fail(code, message, statusCode) { return Object.assign(new Error(message), { code, statusCode }); }
function fileFor(id) { return path.join(ROOT, crypto.createHash("sha256").update(String(id)).digest("hex") + ".json"); }
function read(id) {
  const file = fileFor(id);
  if (!fs.existsSync(file)) return { schemaVersion: 1, votes: {}, counts: {}, total: 0, revision: 0 };
  const data = cache.read(file);
  // Never replace unreadable persistent votes with an empty set.
  if (!data || data.schemaVersion !== 1 || !data.votes || !data.counts || !Number.isSafeInteger(data.total)) {
    throw fail("NOTICE_REACTIONS_UNAVAILABLE", "表情暂时无法读取，请稍后重试", 503);
  }
  return data;
}
function summary(notice, principal) {
  const data = read(notice.id);
  const allowedIds = normalizeIds(notice.reactionEmojis);
  return {
    enabled: notice.displayMode !== "daily-tip" && notice.reactionsEnabled !== false,
    allowedIds,
    total: data.total,
    revision: data.revision,
    items: CATALOG.filter((item) => data.counts[item.id] > 0)
      .map((item) => ({ ...item, count: data.counts[item.id] }))
      .sort((a, b) => b.count - a.count),
    ...(principal ? { myReaction: data.votes[principal] || "" } : {}),
  };
}
function owner(session) {
  if (!session || !session.openidHash) throw fail("FOSU_SESSION_REQUIRED", "请重新进入小程序后再回应公告", 401);
  return crypto.createHash("sha256").update("notice-reaction:" + session.openidHash).digest("hex");
}
function setReaction(notice, principal, emoji) {
  if (emoji !== null && (typeof emoji !== "string" || normalizeIds(notice.reactionEmojis).indexOf(emoji) < 0)) {
    throw fail("NOTICE_REACTION_INVALID", "请选择公告支持的表情", 400);
  }
  if (emoji !== null && notice.reactionsEnabled === false) throw fail("NOTICE_REACTIONS_CLOSED", "这条公告已关闭表情互动", 409);
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const file = fileFor(notice.id), lock = file + ".lock";
  try { fs.mkdirSync(lock); } catch (error) {
    if (error.code === "EEXIST") throw fail("NOTICE_REACTION_BUSY", "回应正在更新，请稍后重试", 503);
    throw error;
  }
  try {
    cache.invalidate(file);
    const data = read(notice.id), previous = data.votes[principal] || "";
    const target = emoji || "";
    if (previous === target) return summary(notice, principal);
    if (!previous && target && data.total >= 100000) throw fail("NOTICE_REACTION_FULL", "这条公告的回应人数已达上限", 409);
    const next = { ...data, votes: { ...data.votes }, counts: { ...data.counts }, revision: data.revision + 1 };
    if (previous) { next.counts[previous] = Math.max(0, (next.counts[previous] || 0) - 1); next.total -= 1; }
    if (target) { next.votes[principal] = target; next.counts[target] = (next.counts[target] || 0) + 1; next.total += 1; }
    else delete next.votes[principal];
    writeJsonAtomic(file, next);
    cache.invalidate(file);
    return summary(notice, principal);
  } finally { fs.rmdirSync(lock); }
}
function publicSummary(notice) {
  if (notice.displayMode === "daily-tip" || String(notice.id).startsWith("temp_")) return { enabled: false, total: 0, items: [], allowedIds: [] };
  try { return summary(notice); } catch (error) { return { enabled: false, unavailable: true, total: 0, items: [], allowedIds: [] }; }
}
module.exports = { CATALOG, summary, publicSummary, owner, setReaction, fileFor };
