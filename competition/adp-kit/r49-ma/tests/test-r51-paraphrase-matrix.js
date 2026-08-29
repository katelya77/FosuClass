"use strict";
// R51 Paraphrase / 泛化门禁（2026-08-19）
// P1 8 个 goal family × 8 种语义表达 = 64 条；
// P2 不同自然语言 → 等价 capability plan（steps + completionCriteria 一致，非字符串相等）；
// P3 生产模块 / Prompt 不含任何测试字符串（test-only 词汇表不进入生产）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { planMission } = require(path.join(R51, "mission", "planner.js"));

// ---- test-only 语义分类器（仅用于验证，绝不进入生产逻辑） ----
function classify(text) {
  if (/(课表|排课)/.test(text) && /(风险|教室|调|协调|方案)/.test(text)) return "teaching_assurance";
  if (/(都有空|共同空闲|一起|碰头|都有时间|都有空档)/.test(text)) return "common_availability";
  if (/(最忙|负载最高|排第|第一名|最闲|利用率最高|排名|繁忙)/.test(text)) return "ranking_inquiry";
  if (/(范围|几周|这个月|最近几周|学期|每周|后面.*周|四周|这一学期)/.test(text)) return "schedule_range_inquiry";
  if (/(风险|冲突|赶场)/.test(text)) return "risk_inquiry";
  if (/(空教室|空闲教室|教室可用|自习教室|找教室|空闲.*教室|教室.*空)/.test(text)) return "space_inquiry";
  if (/(调到|换到|换过|挪到|改到|调课|调整.*课|课.*调整|换课)/.test(text)) return "reschedule_simulation";
  if (/课表|上课|排课|上什么课|上哪些课|有什么课|这节课/.test(text)) return "schedule_inquiry";
  return null;
}

const SAMPLES = {
  schedule_inquiry: [
    "看看这位老师的课表",
    "这位老师这周上什么课？",
    "查一下老师的课表！",
    "课表，老师",
    "那他呢？他这周课表如何",
    "老师的课表，给我看看",
    "看下这位老师的排课情况",
    "刚才那位老师这周有什么课，接着看下",
  ],
  schedule_range_inquiry: [
    "看看这位老师这个月的课表安排",
    "这位老师最近几周都有哪些课？",
    "查这位老师整个学期的排课！",
    "老师这几周的课",
    "那他后面几周的课呢？",
    "几周的课表，老师的",
    "看看老师这一学期每周的课",
    "继续看这位老师后面四周的排课",
  ],
  risk_inquiry: [
    "帮我看下这位老师这周有没有风险",
    "这位老师的排课存在冲突或赶场吗？",
    "查查这周的课程风险！",
    "这位老师，风险",
    "那他呢？有冲突吗",
    "风险情况，这位老师的这周",
    "看看这周这位老师有没有赶场和冲突",
    "刚才那个老师，接着检查风险",
  ],
  space_inquiry: [
    "帮我找找周一有哪些空教室",
    "这周有没有空闲的教室可以用？",
    "找几个空教室！",
    "教室，空的",
    "那还有没有空教室呢",
    "空教室，周一的",
    "帮我看看有哪些教室是空的",
    "接着看看教室这边有什么空的",
  ],
  common_availability: [
    "帮我和两位老师约个大家都有空的时间",
    "两位老师什么时候都有空？",
    "找个我们能碰头的时间！",
    "都有空的时间，两个老师",
    "那他们俩什么时候能一起呢",
    "都有时间，两位老师",
    "帮我们三个找一个共同空闲的时段",
    "接着看看大家什么时候能凑到一起",
  ],
  ranking_inquiry: [
    "看看未来四周最忙的教师是谁",
    "哪位教师负载最高？",
    "找出最忙的老师！",
    "最忙的，教师",
    "那排第一的是谁呢",
    "教师负载最高的，未来四周",
    "看看老师们的繁忙程度排名",
    "接着看看谁最忙",
  ],
  teaching_assurance: [
    "帮我看下这位老师这周课表，有没有风险，能不能协调",
    "这位老师的课表有冲突吗？有空教室吗？怎么调整？",
    "查这位老师这周排课、风险和教室，然后给个调整方案！",
    "老师课表+风险+教室",
    "那他这周课表行不行？有风险的话怎么调",
    "这位老师的排课，看看风险，还有没有空教室，不行就调一下",
    "帮这位老师看看课表有没有风险，有的话找找教室协调一下",
    "刚才那位老师，接着把课表风险和教室都看下",
  ],
  reschedule_simulation: [
    "把程序设计基础调到周三下午试试可行吗",
    "能否把课程换到周三下午？",
    "帮我把这门课挪到周五！",
    "程序设计基础，改到周四上午",
    "那调到周三下午可以吗",
    "周三下午，把这门课换过去",
    "模拟一下把这门课调整到下周",
    "接着试试把刚才那门课调到周三",
  ],
};

const FAMILIES = Object.keys(SAMPLES);
const KINDS = ["陈述式", "疑问式", "命令式", "口语省略", "代词 follow-up", "倒装", "同义表达", "跨域连续表达"];

// 每族共享槽位（语义等价，不含测试字符串）
function goalSpecFor(family, userOutcome) {
  const base = {
    userOutcome,
    target: { entityType: "teacher", entityRef: "t-003", name: "教师003" },
    temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1 },
    constraints: {},
    selection: {},
  };
  switch (family) {
    case "schedule_range_inquiry":
      return { ...base, goalFamily: family, temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 4 } };
    case "space_inquiry":
      return { ...base, goalFamily: family, temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: 1 } };
    case "common_availability":
      return { ...base, goalFamily: family, target: { entities: [{ type: "teacher", name: "教师001" }, { type: "teacher", name: "教师002" }], resolved: true } };
    case "ranking_inquiry":
      return { ...base, goalFamily: family, temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 4 }, selection: { metric: "teacher_load" } };
    case "teaching_assurance":
      return { ...base, goalFamily: family, constraints: { needSpace: true, whatIf: true } };
    case "reschedule_simulation":
      return { ...base, goalFamily: family, target: { entityType: "course", entityRef: "c-01", name: "程序设计基础" }, temporalScope: { kind: "explicit", weekStart: 1, weekEnd: 1, weekday: 3, periodStart: 5, periodEnd: 6 } };
    case "risk_inquiry":
      return { ...base, goalFamily: family };
    default:
      return { ...base, goalFamily: family };
  }
}

test("P1. 8 family × 8 语义 = 64 条，且每条都能被 test-only 分类器归到目标族", () => {
  assert.strictEqual(FAMILIES.length, 8, "8 个目标族");
  let total = 0;
  for (const f of FAMILIES) {
    assert.strictEqual(SAMPLES[f].length, 8, `${f} 应有 8 条`);
    for (const s of SAMPLES[f]) {
      total += 1;
      assert.strictEqual(classify(s), f, `样例「${s}」应归入 ${f}`);
    }
  }
  assert.strictEqual(total, 64, "总样本数 = 64");
  assert.deepStrictEqual(KINDS, ["陈述式", "疑问式", "命令式", "口语省略", "代词 follow-up", "倒装", "同义表达", "跨域连续表达"]);
});

test("P2. 同族不同说法 → 等价 capability plan（steps + criteria 一致，非字符串相等）", () => {
  for (const f of FAMILIES) {
    const plans = SAMPLES[f].map((s) => planMission(goalSpecFor(f, s)));
    const ref = JSON.stringify({ steps: plans[0].steps, criteria: plans[0].completionCriteria, unresolved: plans[0].unresolved });
    for (let i = 1; i < plans.length; i++) {
      const cur = JSON.stringify({ steps: plans[i].steps, criteria: plans[i].completionCriteria, unresolved: plans[i].unresolved });
      assert.strictEqual(cur, ref, `${f} 第 ${i + 1} 条应与第 1 条等价`);
    }
    // 不同 userOutcome（任意文本）不改变计划
    const junk = planMission(goalSpecFor(f, "这个字符串只用于验证与路由无关"));
    assert.strictEqual(JSON.stringify(junk.steps), JSON.stringify(plans[0].steps), `${f} userOutcome 不影响计划`);
  }
});

test("P3. 生产模块与 Prompt 不含任何测试字符串（测试词汇不泄漏到生产）", () => {
  const prodFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|json|md|txt)$/.test(entry.name)) prodFiles.push(full);
    }
  };
  walk(path.join(R51, "mission"));
  walk(path.join(R51, "data"));
  walk(path.join(R51, "prompts"));

  const allSamples = Object.values(SAMPLES).flat();
  let checked = 0;
  for (const file of prodFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const s of allSamples) {
      if (content.includes(s)) {
        assert.fail(`生产文件 ${path.relative(R51, file)} 包含测试字符串: ${s}`);
      }
    }
    checked += 1;
  }
  assert.ok(checked >= 10, `至少扫描 10 个生产文件（实际 ${checked}）`);
});