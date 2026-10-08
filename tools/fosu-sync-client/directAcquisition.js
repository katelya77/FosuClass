"use strict";
const crypto = require("crypto");
const path = require("path");
const cache = require("../../shared/syncCacheStore");
const { assertPublicData } = require("../../server/src/shared/fourDirectSourceContract");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function failure(code) { return Object.assign(new Error(code), { code }); }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function responseGuard(response) {
  const text = String(response && response.text || "");
  if (response && [401, 403].includes(response.status) || /统一身份认证|密码登录|name\s*=\s*["']?password|authserver\.fosu\.edu\.cn.*(?:login|ticket)/i.test(text)) throw failure("SESSION_EXPIRED");
  if (/验证码|滑块验证|安全验证|访问过于频繁|captcha/i.test(text)) throw failure("SCHOOL_SECURITY_CHALLENGE");
  if (!response || response.ok === false || response.status >= 400) throw failure("SCHOOL_REQUEST_FAILED");
  if (!text || !/<table\b/i.test(text) && !/暂无(?:课表|课程|排课)|无(?:课表|课程|排课)|没有排课/.test(text)) throw failure("SCHEDULE_PARSE_FAILED");
  return text;
}

async function collectEntities(options) {
  const { term, scope, runId, targets, request, parse, baseDir } = options;
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || !targets || !targets.length) throw failure("DIRECT_DIRECTORY_INCOMPLETE");
  const directoryHash = hash(targets);
  const root = path.join(cache.ensureTermCache(baseDir, term), "checkpoints", scope, runId);
  const seen = new Set();
  const stat = { sourceMode: "network-direct", discoveredEntities: targets.length, requestedEntities: 0, success: 0, empty: 0, failed: 0, parserErrors: 0, scheduleDocuments: 0, courseEvents: 0, requestCount: 0, completedEntities: 0, elapsedMs: 0, estimatedRemainingMs: 0, coverageValid: false };
  let schedules = [], fatal;
  const started = Date.now();
  for (const target of targets) {
    const key = String(target.key || target.code || "");
    if (!key || seen.has(key)) throw failure("DUPLICATE_ENTITY");
    seen.add(key);
    assertPublicData(target);
    const file = path.join(root, hash(key) + ".json");
    const previous = cache.readJson(file, null);
    let items;
    if (previous) {
      if (previous.term !== term || previous.runId !== runId || previous.scope !== scope || previous.directoryHash !== directoryHash || previous.hash !== hash(previous.items)) throw failure("CHECKPOINT_INVALID");
      items = previous.items;
    } else {
      if (stat.requestCount) await (options.sleep || sleep)(options.delayMs === undefined ? 900 + Math.floor(Math.random() * 401) : Math.max(900, options.delayMs));
      stat.requestCount++;
      try {
        const response = await request(target);
        const text = responseGuard(response);
        items = await parse(text, target);
        if (!Array.isArray(items)) throw failure("SCHEDULE_PARSE_FAILED");
        assertPublicData(items);
        cache.writeJsonAtomic(file, { term, scope, runId, directoryHash, items, hash: hash(items) });
      } catch (error) {
        const code = error.code || "SCHOOL_NETWORK_FAILED";
        stat.failed++;
        if (code === "SCHEDULE_PARSE_FAILED") stat.parserErrors++;
        fatal = failure(code);
        stat.requestedEntities++;
        if (["SESSION_EXPIRED", "SCHOOL_SECURITY_CHALLENGE", "SCHEDULE_PARSE_FAILED"].includes(code)) break;
        // Preserve successful checkpoints; never retry a school POST automatically.
        continue;
      }
    }
    const events = items.reduce((sum, item) => sum + (item.courses || []).length, 0);
    events ? stat.success++ : stat.empty++;
    stat.requestedEntities++; stat.completedEntities++;
    schedules = schedules.concat(items);
    stat.scheduleDocuments = schedules.length; stat.courseEvents += events;
    stat.elapsedMs = Date.now() - started;
    stat.estimatedRemainingMs = Math.round(stat.elapsedMs / Math.max(1, stat.completedEntities) * (targets.length - stat.completedEntities));
    if (options.progress) await options.progress(Object.assign({}, stat));
  }
  stat.coverageValid = !fatal && stat.requestedEntities === targets.length && options.directoryComplete !== false;
  stat.elapsedMs = Date.now() - started;
  if (options.progress) await options.progress(Object.assign({}, stat));
  if (fatal) throw Object.assign(fatal, { directSourceSummary: stat });
  return { schedules, summary: stat };
}

module.exports = { collectEntities, failure, responseGuard };
