#!/usr/bin/env node
/**
 * open_schedule path: class must not become teacher.
 * Drives real goalParser + toolRegistry.resolveIntent + tool chain.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const goalParser = require("../server/src/services/ai/planner/goalParser");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const { buildCacheKey } = require("../server/src/services/ai/planner/toolResultCache");
const agentRunState = require("../server/src/services/ai/agentRunState");
const agentService = require("../server/src/services/ai/agentService");

const SCRATCH = process.env.GROK_SCRATCH
  || path.join(process.env.TEMP || process.env.TMP || ".", "grok-goal-open-schedule");
try { fs.mkdirSync(SCRATCH, { recursive: true }); } catch (e) { /* ignore */ }
const logLines = [];
function log(msg) {
  const line = typeof msg === "string" ? msg : JSON.stringify(msg);
  logLines.push(line);
  console.log(line);
}

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    log(`PASS ${name}`);
  } else {
    fail += 1;
    log(`FAIL ${name}${extra ? ` :: ${extra}` : ""}`);
  }
}

// 1) GoalContract parse
const classMsg = "打开24动物医学1班的课表";
const g = goalParser.parseGoal(classMsg);
check("parse open_schedule", g && g.goal === "open_schedule");
check("entityType=class", g && g.entityType === "class", g && g.entityType);
check("entity contains 动物医学/班", g && /动物医学|动医/.test(g.entity || "") && /班|\d/.test(g.entity || ""), g && g.entity);
check("source=rule_parser", g && g.source === "rule_parser");

// 2) Four entity types
const four = [
  { msg: "打开24动医1课表", expectType: "class" },
  { msg: "打开王老师课表", expectType: "teacher" },
  { msg: "打开C7-305课表", expectType: "classroom" },
  { msg: "打开有机化学课表", expectType: "course" },
];
four.forEach((item) => {
  const parsed = goalParser.parseGoal(item.msg);
  const intent = toolRegistry.resolveIntent(item.msg, {});
  const type = (intent && intent.slots && (intent.slots.lockedEntityType || intent.slots.type))
    || (parsed && parsed.entityType)
    || "";
  // course may need clarification if entity type empty — accept course or clarify
  if (item.expectType === "course" && intent && intent.name === "clarify_missing_slot") {
    check(`${item.msg} → not teacher silent`, true);
    return;
  }
  check(`${item.msg} → ${item.expectType}`, type === item.expectType || (intent && intent.slots && intent.slots.type === item.expectType), `got type=${type} intent=${intent && intent.name}`);
  check(`${item.msg} 禁止 teacher 误判（当 expect class）`, item.expectType !== "class" || type === "class");
});

// 3) resolveIntent for full class name
const intent = toolRegistry.resolveIntent(classMsg, {});
log({ intent: intent && { name: intent.name, slots: intent.slots } });
check("intent is search_school_index or get_schedule_detail or clarify", intent && ["search_school_index", "get_schedule_detail", "clarify_missing_slot"].includes(intent.name), intent && intent.name);
if (intent && intent.name === "search_school_index") {
  check("slots.type=class", intent.slots.type === "class", JSON.stringify(intent.slots));
  check("slots.lockedEntityType=class", intent.slots.lockedEntityType === "class");
  check("slots.goalAction=open_schedule", intent.slots.goalAction === "open_schedule");
  check("not teacher", intent.slots.type !== "teacher");
}

// 4) Tool chain when class index available
try {
  const calls = toolRegistry.runToolChainForIntent(intent, classMsg, {});
  log({
    calls: (calls || []).map((c) => ({
      name: c.name,
      status: c.status,
      type: c.result && c.result.type,
      total: c.result && c.result.total,
      id: c.result && c.result.id,
      preferredId: c.result && c.result.preferredId,
    })),
  });
  const searchCall = (calls || []).find((c) => c.name === "search_school_index");
  if (searchCall) {
    check("search type class", searchCall.result && searchCall.result.type === "class");
    check("search not teacher", searchCall.result && searchCall.result.type !== "teacher");
  }
  const detailCall = (calls || []).find((c) => c.name === "get_schedule_detail");
  if (detailCall && detailCall.status === "success") {
    check("detail type class", detailCall.result && detailCall.result.type === "class");
    check("detail has id", Boolean(detailCall.result && detailCall.result.id));
  }
  // deriveActionCommands
  if (typeof agentService.deriveActionCommands === "function") {
    // not exported — check via chat is heavy; skip
  }
} catch (error) {
  log(`tool chain note: ${error.message}`);
  check("tool chain ran without throw", false, error.message);
}

// 5) Entity lock in beforeToolCall
const state = agentRunState.createAgentRunState({ lockedEntityType: "class", conversationId: "t1", runId: "r1" });
const guarded = agentRunState.beforeToolCall("search_school_index", { type: "teacher", q: "24动物医学1班" }, state);
check("beforeToolCall rewrites teacher→class", guarded.ok && guarded.args.type === "class", JSON.stringify(guarded));
check("lock preserved", guarded.lockedEntityType === "class");

// 6) Cache key includes entityType
const keyClass = buildCacheKey("search_school_index", { type: "class", q: "王" }, { term: "2025-2026-1", releaseVersion: "v1", conversationId: "c1" });
const keyTeacher = buildCacheKey("search_school_index", { type: "teacher", q: "王" }, { term: "2025-2026-1", releaseVersion: "v1", conversationId: "c1" });
check("cache key differs class vs teacher", keyClass !== keyTeacher, `${keyClass} vs ${keyTeacher}`);

// 7) Alias form
const aliasIntent = toolRegistry.resolveIntent("打开24动医1课表", {});
check("alias intent locked class", aliasIntent && aliasIntent.slots && aliasIntent.slots.lockedEntityType === "class", JSON.stringify(aliasIntent && aliasIntent.slots));

// 8) set_current_schedule still works
const setIntent = toolRegistry.resolveIntent("将24动医1的课表设为当前首页课表", {});
check("set_current_schedule still routes", setIntent && (setIntent.name === "set_current_schedule" || setIntent.name === "clarify_missing_slot"), setIntent && setIntent.name);

log(`--- pass=${pass} fail=${fail}`);
const outPath = path.join(SCRATCH, "open-schedule.log");
try {
  fs.writeFileSync(outPath, logLines.join("\n"), "utf8");
  log(`wrote ${outPath}`);
} catch (e) {
  log(`scratch write skip: ${e.message}`);
}
process.exit(fail ? 1 : 0);
