"use strict";
// R50.1.2 Control-Plane SSOT 门禁
// 真源：r50.1/agent-tool-bindings.json（唯一 Tool Binding SSOT）
// 契约 A~L：SSOT 自洽；Main=0；Schedule 7 / Risk 4 / Insight 3；academic_context 唯一跨域共享；
//           CUTOVER / ACCEPTANCE / TOOL-MODEL-VISIBILITY 三文档与 SSOT 一致；
//           generate-tool-visibility.js --check 幂等；OpenAPI 全量 13 operations 与 SSOT unique set 一致。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ADP_KIT = path.join(__dirname, "..", "..");
const R501 = path.join(ADP_KIT, "r50.1");

const read = (file) => fs.readFileSync(path.join(R501, file), "utf8");

const SSOT = JSON.parse(read("agent-tool-bindings.json"));
const CUTOVER = read("R50.1-ADP-CONSOLE-CUTOVER.md");
const ACCEPTANCE = read("R50.1-CONSOLE-ACCEPTANCE.md");
const VISIBILITY = read("R50.1-TOOL-MODEL-VISIBILITY.md");

const AGENT_LABEL_TO_KEY = {
  "课程空间（Schedule）": "schedule",
  "风险规划（Risk）": "risk",
  "校园洞察（Insight）": "insight",
  "Main（不绑定 CampusTools）": "main",
};

const extractTools = (row) => [...row.matchAll(/campus_[a-z0-9_]+/g)].map((m) => m[0]);

function assertExactTools(row, expected, label) {
  assert.deepEqual(extractTools(row), expected, `${label} 绑定行与 SSOT 顺序/集合不一致`);
}

test("A. SSOT JSON：13 unique operations / 14 bindings", () => {
  const unique = [...new Set(Object.values(SSOT.agents).flat())];
  assert.equal(SSOT.uniqueOperationCount, 13, "uniqueOperationCount 必须为 13");
  assert.equal(unique.length, 13, "SSOT unique 工具集必须恰好 13 个");
  const bindings = Object.values(SSOT.agents).reduce((n, list) => n + list.length, 0);
  assert.equal(SSOT.bindingCount, 14, "bindingCount 必须为 14");
  assert.equal(bindings, 14, "SSOT agents 求和必须为 14 个绑定");
  assert.equal(SSOT.version, "R50.1.2");
});

test("B. Main 不绑定 CampusTools（0 个）", () => {
  assert.deepEqual(SSOT.agents.main, [], "Main 必须为空绑定数组");
});

test("C. Schedule 精确 7 个（顺序与集合一致）", () => {
  assertExactTools(
    SSOT.agents.schedule.join(" "),
    ["campus_schedule_query", "campus_schedule_range_query", "campus_classroom_search", "campus_entity_search", "campus_academic_context", "campus_common_free_time_query", "campus_group_plan"],
    "Schedule",
  );
});

test("D. Risk 精确 4 个（顺序与集合一致）", () => {
  assertExactTools(
    SSOT.agents.risk.join(" "),
    ["campus_risk_check", "campus_day_plan", "campus_academic_context", "campus_reschedule_feasibility"],
    "Risk",
  );
});

test("E. Insight 精确 3 个（顺序与集合一致）", () => {
  assertExactTools(
    SSOT.agents.insight.join(" "),
    ["campus_overview", "campus_teacher_load_query", "campus_room_utilization_query"],
    "Insight",
  );
});

test("F. campus_academic_context 是唯一跨 Agent 重复工具", () => {
  const owners = new Map();
  for (const [agent, tools] of Object.entries(SSOT.agents)) {
    for (const tool of tools) {
      if (!owners.has(tool)) owners.set(tool, []);
      owners.get(tool).push(agent);
    }
  }
  const shared = [...owners.entries()].filter(([, agents]) => agents.length > 1);
  assert.deepEqual(shared, [["campus_academic_context", ["schedule", "risk"]]],
    "唯一跨域共享必须恰为 campus_academic_context（schedule + risk）");
  assert.deepEqual(SSOT.sharedTools, { campus_academic_context: ["schedule", "risk"] },
    "sharedTools 声明必须与 agents 实际分布一致");
});

test("G. 其余工具不得跨 Agent 重复", () => {
  const seen = new Set();
  for (const tool of Object.values(SSOT.agents).flat()) {
    if (tool === "campus_academic_context") continue;
    assert.ok(!seen.has(tool), `${tool} 不得出现在多个 Agent`);
    seen.add(tool);
  }
});

function cutoverRow(agentLabel) {
  const re = new RegExp(`^\\|\\s*${agentLabel}[^|]*\\|([^\\n]+)\\|`, "m");
  const match = CUTOVER.match(re);
  assert.ok(match, `CUTOVER 缺少 ${agentLabel} 绑定行`);
  return match[1];
}

test("H. CUTOVER 与 SSOT 一致", () => {
  assertExactTools(cutoverRow("Main"), [], "CUTOVER Main");
  assertExactTools(cutoverRow("课程空间（Schedule）"), SSOT.agents.schedule, "CUTOVER Schedule");
  assertExactTools(cutoverRow("风险规划（Risk）"), SSOT.agents.risk, "CUTOVER Risk");
  assertExactTools(cutoverRow("校园洞察（Insight）"), SSOT.agents.insight, "CUTOVER Insight");
  assert.match(CUTOVER, /13\s*个\s*(?:unique\s*)?Agent Tool/);
  assert.match(CUTOVER, /14\s*个\s*Agent\s*绑定/);
});

test("I. ACCEPTANCE T1 与 SSOT 一致", () => {
  const re = /^\s{2}- (Main|Schedule|Risk|Insight)[^：:]{0,20}[：:] ?([^\n]+)。/gm;
  const rows = new Map();
  let m;
  while ((m = re.exec(ACCEPTANCE)) !== null) rows.set(m[1], m[2]);
  assert.ok(rows.has("Main") && rows.has("Schedule") && rows.has("Risk") && rows.has("Insight"),
    "ACCEPTANCE 必须含 Main/Schedule/Risk/Insight 四行严格映射");
  assert.deepEqual(extractTools(rows.get("Main")), [], "ACCEPTANCE Main 不得绑定 CampusTools");
  assertExactTools(rows.get("Schedule"), SSOT.agents.schedule, "ACCEPTANCE Schedule");
  assertExactTools(rows.get("Risk"), SSOT.agents.risk, "ACCEPTANCE Risk");
  assertExactTools(rows.get("Insight"), SSOT.agents.insight, "ACCEPTANCE Insight");
  assert.match(ACCEPTANCE, /13\s*个\s*(?:unique\s*)?Agent Tool/);
  assert.match(ACCEPTANCE, /14\s*个\s*Agent\s*绑定/);
});

test("J. TOOL-MODEL-VISIBILITY 与 SSOT 一致（新 6 工具绑定 + 13/14 规则陈述）", () => {
  const rowRe = /^\| `(campus_[a-z0-9_]+)` \| `[^`]+` \| ([^|]+) \| OFF \|/gm;
  const rows = new Map();
  let m;
  while ((m = rowRe.exec(VISIBILITY)) !== null) rows.set(m[1], m[2]);
  assert.equal(rows.size, 6, "Visibility 总览表必须恰含新 6 工具");
  const unique = new Set(Object.values(SSOT.agents).flat());
  for (const [tool, cell] of rows) {
    assert.ok(unique.has(tool), `Visibility 出现 SSOT 之外的工具 ${tool}`);
    const owners = cell.split("＋").map((label) => AGENT_LABEL_TO_KEY[label.trim()]);
    assert.ok(owners.length >= 1 && owners.every(Boolean), `${tool} 绑定列解析失败: ${cell}`);
    const expected = Object.entries(SSOT.agents).filter(([, list]) => list.includes(tool)).map(([agent]) => agent);
    assert.deepEqual(owners, expected, `${tool} 绑定列与 SSOT 不一致`);
  }
  assert.match(VISIBILITY, /13\s*个\s*unique Agent Tool\s*\/\s*14\s*个\s*Agent 绑定/);
  assert.match(VISIBILITY, /campus_academic_context` 为唯一跨域共享/);
  assert.match(VISIBILITY, /Main 不直接绑定 CampusTools/);
});

test("K. generate-tool-visibility.js --check 幂等（文档与生成器一致）", () => {
  const stdout = execFileSync(process.execPath, [path.join(R501, "generate-tool-visibility.js"), "--check"], { encoding: "utf8" });
  assert.match(stdout, /\[pass\]/, "生成器 --check 必须输出 [pass]");
});

test("L. OpenAPI 全量 13 operations 与 SSOT unique set 完全一致", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ADP_KIT, "r49-ma", "tools", "openapi", "campus-agent-tools.adp-import.json"), "utf8"));
  const ops = [];
  for (const item of Object.values(spec.paths || {})) {
    if (item && item.post && item.post.operationId) ops.push(item.post.operationId);
  }
  assert.equal(ops.length, 13, "adp-import OpenAPI 必须恰有 13 个 operations");
  assert.deepEqual([...ops].sort(), [...new Set(Object.values(SSOT.agents).flat())].sort(),
    "OpenAPI operations 集合必须与 SSOT unique 工具集完全一致");
});