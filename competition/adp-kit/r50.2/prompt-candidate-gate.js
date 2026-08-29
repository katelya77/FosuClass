#!/usr/bin/env node
"use strict";
// R50.2B Prompt Candidate Gate（2026-08-19）
// 基线模式（默认）：校验 r50.2/prompts/*.final.md 与 r50 编译器当前输出字节一致，
// 且 R50.2B Widget 措辞不削弱 R50.2A 语义不变量；同时扫描 4 个快照的泄漏面。
// 候选模式（--candidates）：批量校验 prompt-candidates/{main,schedule,risk,insight}.md
// （ADP AI 一键优化保存的候选），一次报告：必需不变量丢失、工具归属漂移、
// 静默默认周、child→child 路由、调课/写操作虚构、内部字段暴露。
// 用法：
//   node prompt-candidate-gate.js                 # 基线快照门禁
//   node prompt-candidate-gate.js --candidates    # 候选批量门禁（缺失候选则跳过）
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SNAPSHOT_DIR = path.join(ROOT, "prompts");
const CANDIDATE_DIR = path.join(ROOT, "prompt-candidates");
const COMPILER = path.join(ROOT, "..", "r50", "build-agent-prompts.js");

const SNAPSHOT_FILES = {
  main: "main-orchestrator.final.md",
  schedule: "schedule-space.final.md",
  risk: "risk-planning.final.md",
  insight: "campus-insight.final.md",
};

const TOOL_OWNERSHIP = {
  schedule: [
    "campus_schedule_query",
    "campus_schedule_range_query",
    "campus_classroom_search",
    "campus_entity_search",
    "campus_academic_context",
    "campus_common_free_time_query",
    "campus_group_plan",
  ],
  risk: ["campus_risk_check", "campus_day_plan", "campus_academic_context", "campus_reschedule_feasibility"],
  insight: ["campus_overview", "campus_teacher_load_query", "campus_room_utilization_query"],
};

const FORBIDDEN_CROSS_TOOLS = {
  main: [],
  schedule: [
    "campus_risk_check", "campus_day_plan", "campus_reschedule_feasibility",
    "campus_overview", "campus_teacher_load_query", "campus_room_utilization_query",
  ],
  risk: [
    "campus_schedule_query", "campus_schedule_range_query", "campus_classroom_search",
    "campus_common_free_time_query", "campus_group_plan",
    "campus_overview", "campus_teacher_load_query", "campus_room_utilization_query",
  ],
  insight: [
    "campus_schedule_query", "campus_schedule_range_query", "campus_classroom_search",
    "campus_common_free_time_query", "campus_group_plan",
    "campus_risk_check", "campus_day_plan", "campus_reschedule_feasibility",
    "campus_entity_search",
  ],
};

const BASELINE_INVARIANTS = {
  main: [
    ["不绑定 CampusTools", "Main 不得绑定校园工具"],
    ["KnowledgeRetrievalAnswer", "Main 知识检索"],
    ["Agent transfer", "Agent 转移"],
    ["clarification", "澄清开关"],
  ],
  schedule: [
    ["fresh-tool-call 铁律", "fresh-tool-call 铁律"],
    ["绝不静默默认 week=1", "静默默认周被禁止"],
    ["campus_group_plan", "群体计划工具"],
    ["campus-result-unified-v1", "统一结果卡"],
    ["sys.chat", "官方 sys.chat 动作"],
    ["交回主协调", "child→Main 路由"],
  ],
  risk: [
    ["fresh-tool-call 铁律", "fresh-tool-call 铁律"],
    ["绝不静默默认 week=1", "静默默认周被禁止"],
    ["绝不产生真实写操作", "禁止写操作"],
    ["simulated", "调课模拟标记"],
    ["campus-result-unified-v1", "统一结果卡"],
    ["sys.chat", "官方 sys.chat 动作"],
    ["交回主协调", "child→Main 路由"],
  ],
  insight: [
    ["并列实体共享同一 rank，但榜单位置不变", "并列位次不变量"],
    ["绝不静默默认 week=1", "静默默认周被禁止"],
    ["campus-result-unified-v1", "统一结果卡"],
    ["sys.chat", "官方 sys.chat 动作"],
    ["交回主协调", "child→Main 路由"],
  ],
};

const CANDIDATE_INVARIANTS = {
  main: [
    ["不绑定 CampusTools", "Main 不得绑定校园工具"],
    ["KnowledgeRetrievalAnswer", "Main 知识检索"],
    ["clarification", "澄清开关"],
    ["Agent transfer", "Agent 转移"],
  ],
  schedule: [
    ["fresh-tool-call 铁律", "fresh-tool-call 铁律"],
    ["绝不静默默认 week=1", "静默默认周被禁止"],
    ["campus-result-unified-v1", "统一结果卡"],
    ["sys.chat", "官方 sys.chat 动作"],
    ["交回主协调", "child→Main 路由"],
  ],
  risk: [
    ["fresh-tool-call 铁律", "fresh-tool-call 铁律"],
    ["绝不静默默认 week=1", "静默默认周被禁止"],
    ["绝不产生真实写操作", "禁止写操作"],
    ["simulated", "调课模拟标记"],
    ["campus-result-unified-v1", "统一结果卡"],
    ["交回主协调", "child→Main 路由"],
  ],
  insight: [
    ["并列实体共享同一 rank，但榜单位置不变", "并列位次不变量"],
    ["绝不静默默认 week=1", "静默默认周被禁止"],
    ["campus-result-unified-v1", "统一结果卡"],
    ["交回主协调", "child→Main 路由"],
  ],
};

const INTERNAL_TOKENS = ["queryId", "dataHash", "dataVersion", "NodeID", "VarBizID", "rankContext", "temporalContext", "sourceTool"];

const LEAK_PATTERNS = [
  [/sk-[a-z0-9._-]*\d[a-z0-9._-]*/i, "密钥形令牌"],
  [/authorization\s*[:=]/i, "授权头"],
  [/bearer\s+[a-z0-9]/i, "Bearer 令牌"],
  [/https?:\/\/(localhost|127\.0\.0\.1|[\w-]+\.internal)/i, "内部地址"],
  [/https?:\/\/[^\s"']*\/api\//i, "内部 API 路径"],
];

function missingInvariants(text, invariants) {
  return invariants.filter(([phrase]) => !text.includes(phrase)).map(([, label]) => label);
}

function forbiddenToolsPresent(text, domain) {
  return FORBIDDEN_CROSS_TOOLS[domain].filter((tool) => text.includes(tool));
}

function internalTokenExposure(text) {
  const present = INTERNAL_TOKENS.filter((token) => text.includes(token));
  const hasGuard = text.includes("不默认展示") || text.includes("内部协议");
  return present.length > 0 && !hasGuard ? present : [];
}

function leakHits(text) {
  return LEAK_PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

function domainSection(text) {
  // 域 Prompt 从「## 域 Prompt」标题开始；其上的 shared 策略允许跨域工具的信息性引用
  //（如 ranking-policy 的「排名真源」、entity-policy 的解析约定），不属于归属声明。
  const marker = "## 域 Prompt";
  const index = text.lastIndexOf(marker);
  return index === -1 ? text : text.slice(index + marker.length);
}

function checkPrompt(text, domain, invariants) {
  const problems = [];
  const lost = missingInvariants(text, invariants);
  if (lost.length) problems.push(`必需不变量缺失：${lost.join(" / ")}`);
  const drift = forbiddenToolsPresent(domainSection(text), domain);
  if (drift.length) problems.push(`工具归属漂移（域段内出现他域工具）：${drift.join(", ")}`);
  const exposed = internalTokenExposure(text);
  if (exposed.length) problems.push(`内部字段可能被暴露（无「不默认展示」保护）：${exposed.join(", ")}`);
  const leaks = leakHits(text);
  if (leaks.length) problems.push(`泄漏面命中：${leaks.join(" / ")}`);
  return problems;
}

function baselineGate() {
  const { execFileSync } = require("child_process");
  const problems = [];
  for (const [domain, file] of Object.entries(SNAPSHOT_FILES)) {
    const snapshot = fs.readFileSync(path.join(SNAPSHOT_DIR, file), "utf8");
    const compiled = execFileSync("node", [COMPILER, "--print", domain], { encoding: "utf8" });
    if (snapshot !== compiled) {
      problems.push(`${file}: 快照与编译器当前输出不一致（先重新编译并同步 r50.2/prompts）`);
      continue;
    }
    problems.push(...checkPrompt(snapshot, domain, BASELINE_INVARIANTS[domain]).map((p) => `${file}: ${p}`));
  }
  if (problems.length) {
    console.error("[FAIL] R50.2B prompt baseline gate");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log(`[PASS] R50.2B prompt baseline gate：4 个快照与编译器字节一致，不变量与泄漏面全部通过`);
}

function candidatesGate() {
  if (!fs.existsSync(CANDIDATE_DIR)) {
    console.log("[SKIP] prompt-candidates/ 不存在，跳过候选批量门禁");
    return;
  }
  const files = fs.readdirSync(CANDIDATE_DIR).filter((f) => /\.md$/.test(f)).sort();
  const byDomain = {};
  for (const file of files) {
    const domain = Object.keys(SNAPSHOT_FILES).find((d) => file.replace(/\.md$/, "") === d);
    if (domain) byDomain[domain] = path.join(CANDIDATE_DIR, file);
  }
  if (!Object.keys(byDomain).length) {
    console.log("[SKIP] prompt-candidates/ 无 {main,schedule,risk,insight}.md 候选，跳过");
    return;
  }
  let failed = false;
  for (const domain of Object.keys(SNAPSHOT_FILES)) {
    if (!byDomain[domain]) {
      console.log(`[skip] ${domain}: 无候选文件`);
      continue;
    }
    const text = fs.readFileSync(byDomain[domain], "utf8");
    const problems = checkPrompt(text, domain, CANDIDATE_INVARIANTS[domain]);
    if (problems.length) {
      failed = true;
      console.error(`[FAIL] candidate ${domain}.md`);
      problems.forEach((p) => console.error(`  - ${p}`));
    } else {
      console.log(`[PASS] candidate ${domain}.md：不变量、归属、路由、写操作、内部字段全部通过`);
    }
  }
  if (failed) process.exit(1);
  console.log("[PASS] R50.2B prompt-candidate 批量门禁：全部已保存候选合规");
}

if (process.argv.includes("--candidates")) {
  candidatesGate();
} else {
  baselineGate();
}