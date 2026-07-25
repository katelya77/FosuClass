#!/usr/bin/env node
/**
 * AG-UI event order: RUN_STARTED … RUN_FINISHED (or RUN_ERROR)
 * threadId=conversationId, runId=agent runId
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const agui = require("../server/src/services/ai/aguiAdapter");

const SCRATCH = process.env.GROK_SCRATCH
  || path.join(process.env.TEMP || process.env.TMP || ".", "grok-goal-agui");
try { fs.mkdirSync(SCRATCH, { recursive: true }); } catch (e) { /* ignore */ }

let pass = 0;
let fail = 0;
const lines = [];
function check(name, cond, extra) {
  const msg = cond ? `PASS ${name}` : `FAIL ${name}${extra ? ` :: ${extra}` : ""}`;
  lines.push(msg);
  console.log(msg);
  if (cond) pass += 1; else fail += 1;
}

const events = agui.mapRunToAguiEvents({
  conversationId: "conv-abc",
  runId: "run-xyz",
  events: [
    { type: "run.accepted", at: "2026-07-25T00:00:00.000Z" },
    { type: "intent.resolved", intentName: "open_schedule" },
    { type: "tool.started", tool: "search_school_index" },
    { type: "tool.completed", tool: "search_school_index" },
    { type: "tool.started", tool: "get_schedule_detail" },
    { type: "tool.completed", tool: "get_schedule_detail" },
    { type: "response.composing" },
    { type: "run.completed" },
  ],
  answer: "已为你找到24动物医学1班的课表。",
  cards: [{ type: "schedule_card", title: "24动物医学1班" }],
  actionCommands: [{ command: "navigate", label: "打开课表" }],
  runtimeMode: "public",
});

check("has events", events.length >= 4, String(events.length));
check("first is RUN_STARTED", events[0].type === "RUN_STARTED", events[0] && events[0].type);
const types = events.map((e) => e.type);
check("has TOOL_CALL_START", types.includes("TOOL_CALL_START"));
check("has TOOL_CALL_ARGS", types.includes("TOOL_CALL_ARGS"));
check("has TOOL_CALL_END", types.includes("TOOL_CALL_END"));
check("has STATE_SNAPSHOT", types.includes("STATE_SNAPSHOT"));
check("has TEXT_MESSAGE_CONTENT", types.includes("TEXT_MESSAGE_CONTENT"));
const terminal = events.filter((e) => e.type === "RUN_FINISHED" || e.type === "RUN_ERROR");
check("has terminal", terminal.length >= 1);
check("threadId mapping", events.every((e) => e.threadId === "conv-abc"));
check("runId mapping", events.every((e) => e.runId === "run-xyz"));

const snapshot = events.find((e) => e.type === "STATE_SNAPSHOT");
check("snapshot carries cards", snapshot && snapshot.snapshot && Array.isArray(snapshot.snapshot.cards) && snapshot.snapshot.cards.length === 1);
check("snapshot carries actionCommands", snapshot && snapshot.snapshot && snapshot.snapshot.actionCommands.length === 1);

const sse = agui.serializeSse(events);
check("sse has event lines", /event: RUN_STARTED/.test(sse) && /event: RUN_FINISHED/.test(sse));

// error path
const errEvents = agui.mapRunToAguiEvents({
  conversationId: "c2",
  runId: "r2",
  events: [{ type: "run.accepted" }, { type: "run.failed", code: "X" }],
  failed: true,
  error: { message: "boom" },
});
check("error path has RUN_ERROR", errEvents.some((e) => e.type === "RUN_ERROR"));

console.log(`--- pass=${pass} fail=${fail}`);
try {
  fs.writeFileSync(path.join(SCRATCH, "agui-events.log"), lines.concat(JSON.stringify(types)).join("\n"), "utf8");
} catch (e) { /* ignore */ }
process.exit(fail ? 1 : 0);
