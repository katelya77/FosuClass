"use strict";
// R50.1 Prompt Convergence 门禁（2026-08-18）
// 目标：验证 r50/agents 与 r50.1/prompts（Paste Pack）满足 R50.1 收敛契约：
//  P1 branding 统一（校园智序 · 小序，禁止 小佛助手/佛课小表/真实校名）
//  P2 删除模型硬编码（model= / youtu-agent 不得出现在 Prompt 正文）
//  P3 Main 收敛：纯 Orchestrator（KnowledgeRetrievalAnswer + Agent transfer only，不直接调用 CampusTools）
//  P4 去案例化第二轮：禁止具体用户句式（看看Top1课表/检查Top1风险/未来四周教师负载+全局校区态势）
//  P5 语义类别 > 字面：排位下钻/风险下钻以「当…时」语义类别表述
//  P6 What-if 边界：调课模拟绝不描述为「已经成功调课」
//  P7 new Turn → Main；禁止 Child→Child；Child 缺参回 Main
//  P8 final.md 清洁度：无可粘贴污染（无开发说明/路径/编译指令/include 标记）
//  P9 Paste Pack 一致性：prompts/*.final.md 与编译产物字节一致
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const R50 = path.join(KIT, "r50");
const R501 = path.join(KIT, "r50.1");
const read = (p) => fs.readFileSync(path.join(KIT, p), "utf8");

const MAIN = read("r50/agents/main-orchestrator.md");
const SCHEDULE = read("r50/agents/schedule-space.md");
const RISK = read("r50/agents/risk-planning.md");
const INSIGHT = read("r50/agents/campus-insight.md");
const DOMAINS = { MAIN, SCHEDULE, RISK, INSIGHT };
const SHARED = ["core-safety.md", "intent-policy.md", "temporal-policy.md",
  "entity-policy.md", "context-policy.md", "ranking-policy.md", "output-policy.md"]
  .map((f) => read(`r50/agents/shared/${f}`)).join("\n");

function allFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFilesUnder(p));
    else out.push(p);
  }
  return out;
}

const ALL_R50 = allFilesUnder(R50).filter((f) => f.endsWith(".md") || f.endsWith(".js"))
  .map((f) => fs.readFileSync(f, "utf8")).join("\n");

const PROMPT_FILES = allFilesUnder(path.join(R50, "agents")).filter((f) => f.endsWith(".md"))
  .map((f) => fs.readFileSync(f, "utf8")).join("\n")
  + fs.readFileSync(path.join(R50, "build-agent-prompts.js"), "utf8");

test("R51-P1 branding 统一：禁止 小佛助手/佛课小表/真实校名，含 校园智序/小序", () => {
  assert.doesNotMatch(PROMPT_FILES, /小佛助手|佛课小表|小佛AI/, "Prompt 语义域（agents + 编译器）不得出现旧品牌");
  assert.doesNotMatch(PROMPT_FILES, /佛山大学|华南理工|韩山师范|仙溪校区|江湾校区|河滨校区/, "Prompt 语义域不得出现真实高校身份");
  for (const [name, text] of Object.entries(DOMAINS)) {
    assert.match(text, /小序/, `${name} 必须使用品牌「小序」`);
  }
  assert.match(MAIN, /校园智序/, "Main 必须声明应用名「校园智序」");
});

test("R51-P2 模型选择不属于 Prompt 语义契约（model= / youtu-agent 禁止出现在 Prompt 正文）", () => {
  for (const [name, text] of Object.entries(DOMAINS)) {
    assert.doesNotMatch(text, /model\s*=|youtu-agent/, `${name} 不得包含模型硬编码（模型属于 Console Runtime Config）`);
  }
  assert.doesNotMatch(SHARED, /model\s*=|youtu-agent/, "shared 策略不得包含模型硬编码");
});

test("R51-P3 Main 收敛：纯 Orchestrator，不直接调用 CampusTools", () => {
  assert.match(MAIN, /KnowledgeRetrievalAnswer/, "Main 必须可用 KnowledgeRetrievalAnswer");
  assert.match(MAIN, /Agent transfer/, "Main 必须可用 Agent transfer");
  assert.match(MAIN, /不直接调用/, "Main 必须声明不直接调用 CampusTools");
  assert.match(MAIN, /唯一澄清出口|唯一.*澄清/, "Main 必须是唯一澄清出口");
  assert.match(MAIN, /新\s*Turn\s*一律由 Main 重新接管|新 Turn → Main/, "Main 必须声明新 Turn 一律由 Main 接管");
  assert.doesNotMatch(MAIN, /你[^。\n]{0,20}调用\s*(campus_|这些工具|以下工具)/, "Main 不得出现「你调用 campus_*」的直接调用授权表述");
  for (const tool of ["campus_schedule_query", "campus_schedule_range_query", "campus_classroom_search",
    "campus_entity_search", "campus_academic_context", "campus_common_free_time_query", "campus_group_plan",
    "campus_risk_check", "campus_day_plan", "campus_reschedule_feasibility",
    "campus_overview", "campus_teacher_load_query", "campus_room_utilization_query"]) {
    assert.match(MAIN, new RegExp(tool), `Main 路由表必须声明 ${tool} 的归属（编排知识）`);
  }
});

test("R51-P4 去案例化第二轮：禁止具体用户句式字面", () => {
  const ALL = [MAIN, SCHEDULE, RISK, INSIGHT, SHARED].join("\n");
  assert.doesNotMatch(ALL, /看看Top1课表|查看Top1课表|检查Top1风险|未来四周教师负载[\s\S]{0,30}全局校区态势/,
    "Prompt 不得依赖具体用户句式（Semantic Class > Literal Phrase）");
  assert.doesNotMatch(ALL, /教师\s*0\d\d|T\d{2,}/, "Prompt 不得硬编码比赛实体（case overfitting）");
});

test("R51-P5 语义类别 > 字面：排位下钻与风险下钻以语义类别表述", () => {
  assert.match(SCHEDULE, /排位引用进入 schedule detail 域[\s\S]{0,200}(选中实体|detailWindow|fresh)/,
    "Schedule 排位下钻必须按语义类别表述（继承选中实体 + detail 时间上下文 + fresh 调用）");
  assert.match(RISK, /排位引用被用于风险域[\s\S]{0,200}(只继承|resolved entity|selectedRank)/,
    "Risk 排位引用必须按语义类别表述（只继承 resolved entity）");
  assert.match(RISK, /聚合 ranking window 不自动等价于单周 risk scope|合法 temporal scope/,
    "Risk 必须声明聚合排名窗口不等价于单周风险 scope");
  assert.match(MAIN, /合法 temporal scope|有效 detail temporal context/,
    "Main 必须承载排位下钻的合法时间范围语义");
  assert.match(INSIGHT, /position 语义|稳定位置/, "Insight 必须保留 position 语义（TopN 不因并列失效）");
});

test("R51-P6 What-if 边界：调课模拟绝不描述为已成功调课", () => {
  assert.match(RISK, /模拟|可行性判断/, "Risk 必须声明 reschedule 为模拟/可行性判断");
  assert.match(RISK, /绝不[^。\n]{0,50}(已经成功调课|已执行|修改)/, "Risk 必须声明绝不把模拟结果描述为已成功调课或已修改原课表");
  assert.doesNotMatch(RISK, /已成功调课(?![\s\S]{0,30}不)/, "Risk 不得出现孤立「已成功调课」正面表述");
});

test("R51-P7 Handoff 中心化：Child 缺参回 Main；禁止 Child→Child", () => {
  for (const [name, text] of Object.entries(DOMAINS)) {
    if (name === "MAIN") continue;
    assert.match(text, /回(交)?(主协调|Main)/, `${name} 必须声明交回主协调`);
    assert.match(text, /NEED_CLARIFICATION/, `${name} 缺参必须回传 NEED_CLARIFICATION（不自行追问）`);
  }
  assert.match(MAIN, /禁止 Child→Child|禁止.*Child[\s\S]{0,20}Child/, "Main 必须声明禁止 Child→Child 直接转交");
});

test("R51-P8 final.md 清洁度：可直接粘贴，无开发说明", () => {
  const finals = ["main-orchestrator.final.md", "schedule-space.final.md", "risk-planning.final.md", "campus-insight.final.md"];
  for (const f of finals) {
    const p = path.join(R501, "prompts", f);
    assert.ok(fs.existsSync(p), `Paste Pack 缺失: ${f}`);
    const text = fs.readFileSync(p, "utf8");
    assert.doesNotMatch(text, /<!--|build-agent-prompts|agents\/shared|compiled|编译|文件路径/, `${f} 不得包含编译器说明/路径/include 标记`);
    assert.match(text, /R50\.1/, `${f} 必须标注 R50.1`);
    assert.match(text, /Agent/, `${f} 必须标注 Agent role`);
    assert.ok(text.length > 1500, `${f} 内容过短（编译产物应完整）`);
  }
});

test("R51-P9 Paste Pack 一致性：prompts/*.final.md 与编译器 final 导出字节一致", () => {
  const { execFileSync } = require("child_process");
  const map = {
    "main-orchestrator.final.md": "main",
    "schedule-space.final.md": "schedule",
    "risk-planning.final.md": "risk",
    "campus-insight.final.md": "insight",
  };
  for (const [final, alias] of Object.entries(map)) {
    const expected = execFileSync(process.execPath, ["build-agent-prompts.js", "--print-final", alias], { cwd: R50, encoding: "utf8" });
    const actual = fs.readFileSync(path.join(R501, "prompts", final), "utf8");
    assert.strictEqual(actual, expected, `${final} 必须与编译器 final 导出字节一致（Paste Pack 不得手工漂移）`);
  }
});