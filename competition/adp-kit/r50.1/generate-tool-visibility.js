"use strict";
// R50.1.2 Tool/Model Visibility 表生成器
// 绑定真源：r50.1/agent-tool-bindings.json（唯一 SSOT，禁止在 Markdown/JS 中另行硬编码绑定）
// 参数真源：r49-ma/tools/openapi/campus-agent-tools.r50-existing-plugin-additions.json（required/optional/console-only）
// 输出：r50.1/R50.1-TOOL-MODEL-VISIBILITY.md（幂等，可重复运行；--check 校验一致性）
// 可见性规则（R50.1 规范 §21）：
//   required   = OpenAPI required 数组
//   optional   = OpenAPI 可选参数
//   console-only = 仅 Console/评测调试使用（用户请求不含；如 baseDate）
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BINDINGS_PATH = path.join(__dirname, "agent-tool-bindings.json");
const SPEC_PATH = path.join(ROOT, "r49-ma", "tools", "openapi", "campus-agent-tools.r50-existing-plugin-additions.json");
const OUT_PATH = path.join(__dirname, "R50.1-TOOL-MODEL-VISIBILITY.md");

const CHECK = process.argv.includes("--check");

const ssot = JSON.parse(fs.readFileSync(BINDINGS_PATH, "utf8"));
const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

const AGENT_LABEL = {
  main: "Main（不绑定 CampusTools）",
  schedule: "课程空间（Schedule）",
  risk: "风险规划（Risk）",
  insight: "校园洞察（Insight）",
};

const AGENTS = ["main", "schedule", "risk", "insight"];

function bindingsOf(agentTool) {
  const owners = AGENTS.filter((agent) => (ssot.agents[agent] || []).includes(agentTool));
  return owners.map((agent) => AGENT_LABEL[agent]).join("＋");
}

const TOOLS = [
  ["campus_entity_search", "EntitySearchInput", "实体清单/搜索", "全部参数可选（空关键词=清单）"],
  ["campus_academic_context", "AcademicContextInput", "Temporal Semantic Core", "intent/date/dateText 三选一语义；baseDate 仅 Console/评测调试，用户请求不含"],
  ["campus_common_free_time_query", "CommonFreeTimeInput", "多实体共同空闲", "entities 必填 2..6"],
  ["campus_room_utilization_query", "RoomUtilizationInput", "教室利用率 Ranking", "weekStart/weekEnd 必填"],
  ["campus_reschedule_feasibility", "RescheduleFeasibilityInput", "调课 What-if 模拟", "sourceLessonId/target 必填；绝不修改数据"],
  ["campus_group_plan", "GroupPlanInput", "群体计划候选", "entities/week 必填"],
];

const consoleOnly = new Set(["baseDate"]);

function row(name, type, req, visibility, desc) {
  return `| ${name} | ${type} | ${req ? "必填" : "可选"} | ${visibility} | ${desc} |`;
}

const lines = [];
lines.push("# R50.1 Tool/Model Visibility 表（新 6 工具）");
lines.push("");
lines.push("> 绑定真源：`r50.1/agent-tool-bindings.json`（R50.1.2 起唯一 SSOT）；参数真源：`r49-ma/tools/openapi/campus-agent-tools.r50-existing-plugin-additions.json`（生成器：`r50.1/generate-tool-visibility.js`，幂等）。");
lines.push("> 可见性规则：`必填`=OpenAPI required；`可选`=缺省有确定性默认；`仅 Console`=该参数只允许 Console/评测调试传（用户请求不含，模型不得生成）。");
lines.push("> 与全量 `campus-agent-tools.adp-import.json` 同 server、$ref 自包含、无明文凭据（既有 `test-adp-import-openapi.js` 派生一致性门禁）。");
lines.push("");
lines.push("## 工具可见性总览");
lines.push("");
lines.push("| Agent Tool | 底层 CampusTools | 绑定 Agent | Direct Result | 说明 |");
lines.push("|---|---|---|---|---|");
for (const [agentTool, schemaName, label, note] of TOOLS) {
  const op = spec.paths["/api/" + agentTool] && spec.paths["/api/" + agentTool].post;
  lines.push(`| \`${agentTool}\` | \`${op ? op.operationId : agentTool}\` | ${bindingsOf(agentTool)} | OFF | ${label}；${note} |`);
}
lines.push("");
lines.push(`> 绑定规则（SSOT：13 个 unique Agent Tool / 14 个 Agent 绑定）：\`campus_academic_context\` 为唯一跨域共享（课程空间（Schedule）＋ 风险规划（Risk）），其余工具单域；Main 不直接绑定 CampusTools。`);
lines.push("");
lines.push("> Direct Result 一律 OFF（R50.1 规范：工具结果先经 Agent 语义整理再回复用户）。");
lines.push("");
lines.push("## 参数可见性明细");
lines.push("");
for (const [agentTool, schemaName, label] of TOOLS) {
  const schema = spec.components.schemas[schemaName];
  if (!schema) continue;
  const req = new Set(schema.required || []);
  lines.push(`### ${agentTool}（${label}）`);
  lines.push("");
  lines.push("| 参数 | 类型 | 必填 | 可见性 | 说明 |");
  lines.push("|---|---|---|---|---|");
  const props = Object.entries(schema.properties || {});
  for (const [name, prop] of props) {
    const type = prop.type || (prop.$ref || "").split("/").pop() || "object";
    const isRequired = req.has(name);
    let visibility = isRequired ? "必填" : "可选";
    if (consoleOnly.has(name)) visibility = "仅 Console";
    const desc = String(prop.description || "").replace(/\|/g, "\\|").slice(0, 120);
    lines.push(row(name, type, isRequired, visibility, desc));
  }
  lines.push("");
}
lines.push("## 模型可见性（R50.1 Runtime Baseline 冻结）");
lines.push("");
lines.push("| 项 | 值 | 说明 |");
lines.push("|---|---|---|");
lines.push("| 模型 | DeepSeek V4 Flash | Console Runtime Baseline 冻结；`model=` 从 Prompt 中删除（R51-P2），改由 Console 统一配置 |");
lines.push("| 高级设置行 | 见各域 Prompt 末尾 | Main 8/6/ON（澄清 Widget）；Schedule 8/6/OFF；Risk 12/6/OFF；Insight 12/6/OFF |");
lines.push("| 可用工具 | KnowledgeRetrievalAnswer + Agent transfer | 仅 Main 可见；Main 不绑定 CampusTools（P3） |");
lines.push("| Direct Result | OFF（全部 13 工具） | 工具结果先语义整理 |");
lines.push("| 用户输入不可见项 | baseDate / intent 内部结构 | 模型只产生语义 intent；原始敏感输入不入模型上下文 |");
lines.push("");

const output = lines.join("\n");

if (CHECK) {
  if (fs.existsSync(OUT_PATH) && fs.readFileSync(OUT_PATH, "utf8") === output) {
    console.log(`[pass] ${OUT_PATH} 与生成器一致（SSOT 幂等）`);
    process.exit(0);
  }
  console.error(`[fail] ${OUT_PATH} 与生成器不一致；请运行 node r50.1/generate-tool-visibility.js 后重试`);
  process.exit(1);
}

fs.writeFileSync(OUT_PATH, output, "utf8");
console.log("written:", OUT_PATH, lines.length, "lines");