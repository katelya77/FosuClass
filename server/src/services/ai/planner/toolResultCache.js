/**
 * Run-scoped tool result cache — replan reuses successful read observations.
 * Key: toolName + canonical JSON args + releaseVersion + term + principal scope.
 */

const crypto = require("crypto");
const { getToolSafetyMeta } = require("../capabilityRouter");

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function principalScope(context = {}, principal = null) {
  if (principal && principal.principalKey) return String(principal.principalKey).slice(0, 64);
  if (context.principalKey) return String(context.principalKey).slice(0, 64);
  if (context.conversationId) return `conv:${String(context.conversationId).slice(0, 48)}`;
  return "anon";
}

function buildCacheKey(toolName, args, context = {}, principal = null) {
  const releaseVersion = String(
    (context.releasePack && context.releasePack.version)
    || context.releaseVersion
    || (context.currentScheduleSummary && context.currentScheduleSummary.releaseVersion)
    || ""
  ).slice(0, 80);
  const term = String(
    context.term
    || (context.currentScheduleSummary && context.currentScheduleSummary.term)
    || context.termCode
    || ""
  ).slice(0, 40);
  const scope = principalScope(context, principal);
  const payload = `${toolName}|${stableStringify(args || {})}|${releaseVersion}|${term}|${scope}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

function isWriteTool(toolName) {
  const meta = getToolSafetyMeta(toolName);
  return meta.operation === "write" || meta.operation === "delete" || meta.requiresConfirmation === true;
}

function isSuccessfulReadCall(call) {
  if (!call || !call.name) return false;
  if (isWriteTool(call.name)) return false;
  if (call.status === "failed" || call.status === "error") return false;
  const result = call.result || {};
  if (result.success === false) return false;
  if (result.requiresConfirmation) return false;
  return true;
}

class ToolResultCache {
  constructor() {
    this.map = new Map();
    this.reusedToolCount = 0;
    this.avoidedDuplicateCalls = 0;
  }

  get(toolName, args, context, principal) {
    const key = buildCacheKey(toolName, args, context, principal);
    return this.map.get(key) || null;
  }

  set(toolName, args, context, principal, call) {
    if (!isSuccessfulReadCall(call)) return false;
    const key = buildCacheKey(toolName, args, context, principal);
    this.map.set(key, {
      key,
      toolName,
      call,
      at: Date.now(),
    });
    return true;
  }

  markReuse() {
    this.reusedToolCount += 1;
    this.avoidedDuplicateCalls += 1;
  }

  metrics() {
    return {
      reusedToolCount: this.reusedToolCount,
      avoidedDuplicateCalls: this.avoidedDuplicateCalls,
      cacheSize: this.map.size,
    };
  }
}

function createToolResultCache() {
  return new ToolResultCache();
}

module.exports = {
  stableStringify,
  buildCacheKey,
  isWriteTool,
  isSuccessfulReadCall,
  ToolResultCache,
  createToolResultCache,
};
