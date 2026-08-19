"use strict";
// R51-I Prompt Architecture 门禁（2026-08-19）
// P1 Main ≤ 5000 字符，children ≤ 4000 字符（UTF-16 长度）；
// P2 Main = 0 CampusTools（声明不直接调用；绑定文件 main=[] 由 SSOT 门禁保障）；
// P3 无测试字符串 / 无「如果用户说」Case 规则 / 无固定教师编号；
// P4 无内部协议泄漏（无 MissionState / task_done / transfer_to / queryId / slotSnapshot / availableFacts / 推理自述）；
// P5 覆盖 R51 关键语义（completion awareness / fresh 纪律 / resolve-before-clarify / 唯一澄清出口 / 能力边界）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const PROMPTS_DIR = path.join(__dirname, "..", "..", "r51", "prompts");
const FILES = {
  main: "main-orchestrator.r51.md",
  schedule: "schedule-space.r51.md",
  risk: "risk-planning.r51.md",
  insight: "campus-insight.r51.md",
};

const BUDGETS = { main: 5000, schedule: 4000, risk: 4000, insight: 4000 };

// 与测试文件一致的泄露探测词
const INTERNAL_TOKENS = ["MissionState", "task_done", "transfer_to", "queryId", "dataHash", "slotSnapshot", "availableFacts", "completedCapabilities", "rankContext", "temporalContext"];
const CASE_PATTERNS = [/如果用户说/, /就执行/, /当用户输入\s*[「“]/, /教师00\d/, /les-\w+/, /c-\d{2}/];

function load(k) {
  const p = path.join(PROMPTS_DIR, FILES[k]);
  return { path: p, text: fs.readFileSync(p, "utf8") };
}

test("I1. 字符预算：Main ≤ 5K，children ≤ 4K", () => {
  for (const [k, budget] of Object.entries(BUDGETS)) {
    const { text, path: p } = load(k);
    const len = Array.from(text).length;
    assert.ok(len <= budget, `${k} ${FILES[k]} 长度 ${len} 超过预算 ${budget}`);
    console.log(`  ${k} chars: ${len} (budget ${budget})`);
  }
});

test("I2. Main 声明不绑定 CampusTools；Main 不出现工具绑定表", () => {
  const main = load("main").text;
  assert.ok(/不直接调用\s*任何 CampusTools|不直接调用.*CampusTools|不持有.*CampusTools/.test(main), "Main 必须声明不直接调用 CampusTools");
  assert.ok(main.includes("Agent transfer"), "Main 持有 Agent transfer 而非 CampusTools");
});

test("I3. 每个 Child 声明能力边界（Owns / Does-not-own）与工具选择原则", () => {
  for (const k of ["schedule", "risk", "insight"]) {
    const t = load(k).text;
    assert.ok(/角色与边界|能力边界/.test(t), `${k} 必须声明能力边界`);
    assert.ok(/你 Owns/.test(t) && /你 Does-not-own/.test(t), `${k} 必须区分 Owns / Does-not-own`);
    assert.ok(/禁止越域调用工具/.test(t), `${k} 必须禁止越域调用`);
  }
});

test("I4. 无测试字符串 / 无 Case 硬编码 / 无固定编号", () => {
  const sampleFragments = ["这周上什么课", "这个月的课表", "最近几周", "调到周三下午", "看看排第一", "最忙的教师", "都有空吗", "一起碰头", "自习教室", "模拟一下", "风险怎么样", "接着检查风险"];
  for (const k of Object.keys(FILES)) {
    const t = load(k).text;
    for (const frag of sampleFragments) {
      assert.ok(!t.includes(frag), `${k} 包含测试/示例字符串: ${frag}`);
    }
    for (const re of CASE_PATTERNS) {
      assert.ok(!re.test(t), `${k} 命中 Case 硬编码模式: ${re}`);
    }
  }
});

test("I5. 无内部协议泄漏：无 MissionState / task_done / transfer_to / queryId / 内部字段 / 推理自述", () => {
  for (const k of Object.keys(FILES)) {
    const t = load(k).text;
    for (const tok of INTERNAL_TOKENS) {
      assert.ok(!t.includes(tok), `${k} 泄漏内部协议字段: ${tok}`);
    }
    assert.ok(!/我认为|现在调用|因此应该/.test(t), `${k} 不得指示输出编排自述`);
    assert.ok(!/import (json|MissionState)/.test(t), `${k} 不得指示输出内部 JSON`);
  }
});

test("I6. Main 覆盖 R51 关键语义", () => {
  const main = load("main").text;
  const checks = [
    ["completion criteria", /completion criteria|完成度判定|produced facts/],
    ["completion awareness（只调工具≠完成）", /只调用一个工具\s*≠\s*完成|只调用一个工具不等于完成/],
    ["fresh 纪律", /FreshFactPolicy|重新调用工具|槽位/],
    ["resolve-before-clarify", /先解析，不澄清|先 ENTITY_RESOLUTION|可被实体解析.*不澄清/],
    ["唯一澄清出口", /唯一.*澄清出口|澄清出口/],
    ["禁止 Child → Child", /禁止 Child → Child|禁止 Child 直接追问用户/],
    ["explicit > 继承", /显式 >|explicit/],
    ["不默认 week=1", /绝不默认 week=1|不得默认 week=1/],
    ["overview 计数不是周", /overview 聚合计数不是教学周|不是教学周/],
    ["排位稳定位置", /稳定位置|TopN 是稳定位置/],
    ["stale escape", /陈旧上下文逃逸|Stale Context Escape/],
  ];
  for (const [name, re] of checks) {
    assert.ok(re.test(main), `Main 缺少关键语义: ${name}`);
  }
});

test("I7. Child 覆盖 preflight / fresh / 结果契约 / 回传 Main", () => {
  for (const k of ["schedule", "risk", "insight"]) {
    const t = load(k).text;
    assert.ok(/INVALID_PARAM|非法参数/.test(t), `${k} 必须提及 preflight 失败关闭`);
    assert.ok(/重新调用工具|不得拿上一轮结果/.test(t), `${k} 必须提及 fresh call 纪律`);
    assert.ok(/SUCCESS|NEED_CLARIFICATION|NO_RESULT|ERROR/.test(t), `${k} 必须定义回传状态契约`);
    assert.ok(/回传 Main/.test(t), `${k} 必须回传 Main（Child 不越级）`);
    assert.ok(/不虚构|NO_RESULT/.test(t), `${k} 空结果不得虚构`);
  }
});

test("I8. R51 prompts 与旧编译器产物隔离（非 COMPILED-BY 产物，独立 canonical source）", () => {
  for (const k of Object.keys(FILES)) {
    const t = load(k).text;
    assert.ok(!t.includes("COMPILED-BY"), `${k} 不得是旧编译器产物`);
    assert.ok(!t.includes("Shared Policy ·"), `${k} 不得全文注入旧 Shared 策略`);
  }
});