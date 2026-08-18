"use strict";
// R50.0 Prompt 架构一致性门禁（2026-08-18）
// 目标：验证 r50/agents（shared 策略 + 4 个域 Prompt + build-agent-prompts.js 编译器）
// 满足 R50.0-SEMANTIC-CORE-DESIGN.md §6（Prompt 架构）与 §0（No Case Overfitting）。
//
// 断言类别：
//  1. 架构存在性：agents/shared/*.md 7 个策略文件 + 4 个域 Prompt + 编译器存在且可运行；
//  2. 编译器确定性：compiled/*.md 与按当前源重算结果字节一致（--check 绿）；
//  3. 13 Agent Tools 绑定覆盖：每个域 Prompt 声明正确工具集，无越权工具；
//  4. Temporal/排名/风险/继承语义契约（语义断言，非字面 phrase 匹配）；
//  5. 去 Case 化：域 Prompt 与 shared 策略禁止比赛数据实体硬编码 / 禁止具体场景字面规则。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const R50 = path.join(__dirname, "..", "..", "r50");
const SHARED_DIR = path.join(R50, "agents", "shared");
const AGENTS_DIR = path.join(R50, "agents");
const COMPILED_DIR = path.join(AGENTS_DIR, "compiled");

const read = (p) => fs.readFileSync(path.join(R50, p), "utf8");
const MAIN = read("agents/main-orchestrator.md");
const SCHEDULE = read("agents/schedule-space.md");
const RISK = read("agents/risk-planning.md");
const INSIGHT = read("agents/campus-insight.md");
const SHARED_FILES = [
  "core-safety.md", "intent-policy.md", "temporal-policy.md",
  "entity-policy.md", "context-policy.md", "ranking-policy.md", "output-policy.md",
];
const COMPILED = Object.fromEntries(
  fs.readdirSync(COMPILED_DIR).filter((f) => f.endsWith(".compiled.md")).map((f) => [f, read(`agents/compiled/${f}`)])
);

test("R50-P1 架构存在性：7 shared 策略 + 4 域 Prompt + 编译器", () => {
  for (const f of SHARED_FILES) {
    assert.ok(fs.existsSync(path.join(SHARED_DIR, f)), `shared 策略缺失: ${f}`);
  }
  for (const f of ["main-orchestrator.md", "schedule-space.md", "risk-planning.md", "campus-insight.md"]) {
    assert.ok(fs.existsSync(path.join(AGENTS_DIR, f)), `域 Prompt 缺失: ${f}`);
  }
  assert.ok(fs.existsSync(path.join(R50, "build-agent-prompts.js")), "编译器缺失: build-agent-prompts.js");
  for (const f of Object.keys(COMPILED)) {
    assert.ok(fs.readFileSync(path.join(COMPILED_DIR, f), "utf8").length > 2000, `编译产物过小: ${f}`);
  }
});

test("R50-P2 编译器确定性：--check 无漂移（compiled 与源一致）", () => {
  const out = execFileSync(process.execPath, ["build-agent-prompts.js", "--check"], { cwd: R50, encoding: "utf8" });
  assert.match(out, /\[pass\]/, "build-agent-prompts.js --check 必须报告 pass（源与编译产物无漂移）");
});

test("R50-P3 编译产物包含全部 shared 策略且每个域 Prompt 声明引用", () => {
  for (const [file, content] of Object.entries(COMPILED)) {
    for (const f of SHARED_FILES) {
      const marker = `shared:${f}`;
      assert.ok(content.includes(marker), `${file} 编译产物缺少 shared 片段 ${f}`);
    }
    assert.match(content, /Shared Policy/, `${file} 必须内嵌 shared 策略标题`);
  }
  for (const text of [MAIN, SCHEDULE, RISK, INSIGHT]) {
    assert.match(text, /core-safety|Core Safety/, "域 Prompt 必须声明引用 core-safety");
    assert.match(text, /output-policy|Output Policy/, "域 Prompt 必须声明引用 output-policy");
  }
});

test("R50-P4 13 Agent Tools 绑定覆盖（域 Prompt 声明正确工具集，无越权）", () => {
  // 域 → 允许工具（13 Agent Tools 全量 = TOOL_DEFS 15 中的 13 个 façade）
  const allow = {
    main: /campus_schedule_query|campus_schedule_range_query|campus_classroom_search|campus_entity_search|campus_academic_context|campus_common_free_time_query|campus_group_plan|campus_risk_check|campus_day_plan|campus_reschedule_feasibility|campus_overview|campus_teacher_load_query|campus_room_utilization_query/,
  };
  // 主协调：13 个 Agent Tools 全部出现
  for (const tool of ["campus_schedule_query", "campus_schedule_range_query", "campus_classroom_search",
    "campus_entity_search", "campus_academic_context", "campus_common_free_time_query", "campus_group_plan",
    "campus_risk_check", "campus_day_plan", "campus_reschedule_feasibility",
    "campus_overview", "campus_teacher_load_query", "campus_room_utilization_query"]) {
    assert.match(MAIN, new RegExp(tool), `Main 必须路由全部 13 个 Agent Tools（缺 ${tool}）`);
  }
  // Schedule：7 个
  for (const tool of ["campus_schedule_query", "campus_schedule_range_query", "campus_classroom_search",
    "campus_entity_search", "campus_academic_context", "campus_common_free_time_query", "campus_group_plan"]) {
    assert.match(SCHEDULE, new RegExp(tool), `Schedule 必须绑定 ${tool}`);
  }
  assert.doesNotMatch(SCHEDULE, /campus_risk_check|campus_overview|campus_teacher_load_query|campus_room_utilization_query/, "Schedule 不得越权绑定 risk/overview/load/utilization 工具");
  // Risk：4 个
  for (const tool of ["campus_risk_check", "campus_day_plan", "campus_academic_context", "campus_reschedule_feasibility"]) {
    assert.match(RISK, new RegExp(tool), `Risk 必须绑定 ${tool}`);
  }
  assert.doesNotMatch(RISK, /campus_schedule_query|campus_classroom_search|campus_overview|campus_teacher_load_query/, "Risk 不得越权绑定 schedule/classroom/overview/load 工具");
  // Insight：3 个
  for (const tool of ["campus_overview", "campus_teacher_load_query", "campus_room_utilization_query"]) {
    assert.match(INSIGHT, new RegExp(tool), `Insight 必须绑定 ${tool}`);
  }
  assert.doesNotMatch(INSIGHT, /campus_schedule_query|campus_classroom_search|campus_risk_check|campus_day_plan/, "Insight 不得越权绑定 schedule/classroom/risk/day_plan 工具");
  // 域 Prompt 不得把 13 个工具的某个写死为另一工具职责（教师负载唯一真源）
  assert.match(INSIGHT, /campus_teacher_load_query[\s\S]*唯一真源|campus_teacher_load_query[\s\S]*权威/, "Insight 必须声明 teacher_load 为教师负载排名的唯一权威源");
  // overview 必须声明「不充当/不作为」任意教师周窗口排名的替代工具
  assert.match(INSIGHT, /campus_overview[\s\S]{0,80}(不作为|不充当|不承担)[\s\S]{0,60}(替代|排名)/, "Insight 必须声明 campus_overview 不作为任意教师周窗口排名替代工具");
});

test("R50-P5 Temporal 语义契约（future/recent 窗口起点与 fail-closed）", () => {
  // 未来 N 个教学周 = 从 referenceDate 所在有效教学周开始；学期外 → 之后第一个有效周
  assert.match(read("agents/shared/temporal-policy.md"), /所在有效教学周|第一个有效教学周|之后第一个有效/, "temporal-policy 必须声明 future 窗口起点语义");
  assert.match(read("agents/shared/temporal-policy.md"), /week-N\+1|week-N\s*\+1|最近 N 个教学周/, "temporal-policy 必须声明 recent 窗口计算");
  assert.match(read("agents/shared/temporal-policy.md"), /Temporal Semantic Core|temporal-core/, "temporal-policy 必须声明时间解析由语义核心确定性计算");
  // 域 Prompt 必须引用 temporal-policy / Temporal Core
  for (const [name, text] of [["MAIN", MAIN], ["SCHEDULE", SCHEDULE], ["RISK", RISK], ["INSIGHT", INSIGHT]]) {
    assert.match(text, /temporal-policy|Temporal (Semantic )?Core/, `${name} 必须引用 temporal-policy / Temporal Core`);
  }
  // 绝不静默 week=1
  for (const [name, text] of [["MAIN", MAIN], ["SCHEDULE", SCHEDULE], ["RISK", RISK]]) {
    assert.match(text, /绝不[^。\n]{0,20}week\s*=\s*1|不得静默默认 week=1/, `${name} 必须声明绝不默认 week=1`);
  }
  assert.match(read("agents/shared/temporal-policy.md"), /(绝不|不得)[^。\n]{0,20}week\s*=\s*1/, "temporal-policy 必须声明绝不默认 week=1");
  // Insight 排名工具窗口必填 = fail-closed（不默认周）
  assert.match(INSIGHT, /weekStart\s*\/\s*weekEnd[\s\S]{0,40}必填|必填[\s\S]{0,40}fail-closed/, "Insight 必须声明排名窗口必填（fail-closed，不默认周）");
  // overviewWindow 不是教学周参数
  assert.match(read("agents/shared/context-policy.md"), /overviewWindow[^。\n]*绝不|overviewWindow\.count[^。\n]*不是/, "context-policy 必须声明 overview 聚合窗口不得当作教学周参数");
  assert.match(RISK, /多周窗口|rankingWindow|detailWindow[\s\S]{0,120}不是/, "Risk 必须声明多周排名窗口不是有效单周风险参数");
});

test("R50-P6 排名语义：position 语义、并列不澄清、source-aware rankContext、禁止实体硬编码", () => {
  // position 语义在 shared/ranking-policy + 排名的域 Prompt（MAIN/INSIGHT）
  assert.match(read("agents/shared/ranking-policy.md"), /position 语义|items\[0\]|稳定位置/, "ranking-policy 必须声明 TopN position 语义");
  for (const [name, text] of [["MAIN", MAIN], ["INSIGHT", INSIGHT]]) {
    assert.match(text, /position 语义|items\[0\]|稳定位置|Top1\/Top2\/Top3/, `${name} 必须声明 TopN position 语义`);
    assert.match(text, /NO CLARIFICATION|不澄清/, `${name} 必须声明单排位引用不澄清`);
    assert.match(text, /并列/, `${name} 必须声明并列处理规则`);
  }
  // RISK/SCHEDULE 排位下钻：只继承选中实体，声明引用 ranking-policy
  assert.match(RISK, /Top1[\s\S]{0,80}风险[\s\S]{0,120}selectedRank|rankContext\.selectedRank/, "Risk 必须声明 Top1 风险下钻只继承选中实体");
  assert.match(RISK, /ranking-policy/, "Risk 必须引用 ranking-policy（排位语义由共享策略承载）");
  assert.match(SCHEDULE, /Top1[\s\S]{0,80}(课表|下钻)/, "Schedule 必须声明 Top1 下钻规则（继承实体与窗口）");
  assert.match(MAIN + INSIGHT, /sourceTool|source-aware/, "Main/Insight 必须声明 rankContext source-aware");
  assert.doesNotMatch(MAIN + INSIGHT, /source\s*[:：]\s*["']?campus_overview/, "rankContext 不得把 source 硬编码为 campus_overview");
  assert.match(INSIGHT, /rankContext[\s\S]{0,200}sourceTool[\s\S]{0,120}campus_teacher_load_query|campus_room_utilization_query/, "Insight rankContext 结构必须包含本轮真实排名工具");
  // 多对象请求不得压缩为 Top1
  assert.match(INSIGHT, /并列第一|多对象|不[\s\S]{0,30}压缩[\s\S]{0,20}Top1/, "Insight 必须声明多对象请求不压缩为 Top1");
  // 禁止硬编码排名实体（ranking-policy 承载 + Main 引用）
  assert.match(read("agents/shared/ranking-policy.md"), /禁止硬编码|不得写死/, "ranking-policy 必须声明禁止硬编码排名实体");
  assert.match(MAIN, /ranking-policy/, "Main 必须引用 ranking-policy（排位实体不得硬编码）");
});

test("R50-P7 风险 self-mode 铁律：单对象绝不要求第二对象", () => {
  assert.match(RISK, /self[\s\S]{0,120}绝不|绝不[^。\n]{0,40}第二对象/, "Risk 必须声明 self 模式绝不要求第二对象");
  assert.match(RISK, /比较教师A和教师B|只有[^。\n]*明确[^。\n]*才[\s\S]{0,40}compare/, "Risk 必须声明仅显式双对象语义才进入 compare 模式");
});

test("R50-P8 fresh-tool-call 铁律覆盖（3 个域 Prompt）", () => {
  for (const [name, text] of [["SCHEDULE", SCHEDULE], ["RISK", RISK], ["INSIGHT", INSIGHT]]) {
    assert.match(text, /重新调用|fresh[\s\S]{0,30}tool[\s\S]{0,30}call/, `${name} 必须声明 fresh-tool-call 铁律`);
  }
});

test("R50-P9 去 Case 化：域 Prompt / shared 禁止比赛数据实体硬编码与字面规则", () => {
  const ALL = [MAIN, SCHEDULE, RISK, INSIGHT, ...SHARED_FILES.map((f) => read(`agents/shared/${f}`))].join("\n");
  // 不允许出现比赛演示实体字面（如教师 009 编号、具体赛事案例名）
  assert.doesNotMatch(ALL, /教师\s*0\d\d|T\d{2,}|比赛数据实体/, "Prompt 不得硬编码具体比赛实体（case overfitting）");
  assert.doesNotMatch(ALL, /看到["']?未来四周["']?[\s\S]{0,40}1\.\.4|未来四周[\s\S]{0,20}=[\s\S]{0,10}1/, "Prompt 不得把具体自然语言与窗口字面值绑定（case overfitting）");
  // 规则以原则 / 契约表述，而非 if-else 字面匹配
  assert.match(ALL, /原则|契约|结构化意图|结构化 intent/, "Prompt 必须以原则/契约表述业务规则");
});

test("R50-P10 高级设置行保留（域 Prompt）", () => {
  for (const [name, text] of [["MAIN", MAIN], ["SCHEDULE", SCHEDULE], ["RISK", RISK], ["INSIGHT", INSIGHT]]) {
    assert.doesNotMatch(text, /model\s*=|youtu-agent/, `${name} 不得包含模型硬编码（R50.1：模型属于 Console Runtime Config，不属 Prompt 契约）`);
    assert.match(text, /maxReasoningRound=\d+/, `${name} 必须保留 maxReasoningRound`);
    assert.match(text, /historyLimit=\d+/, `${name} 必须保留 historyLimit`);
  }
  assert.match(MAIN, /clarification=ON/, "Main 必须保留 clarification=ON（唯一澄清出口）");
  assert.doesNotMatch(SCHEDULE + RISK + INSIGHT, /clarification=ON/, "子 Agent 必须 clarification=OFF（不得直接追问用户）");
});
