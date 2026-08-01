#!/usr/bin/env node
/**
 * P3-M3 rolling summary structured repair + Low#6 verification fail-closed.
 *
 * All cases drive the real production implementations:
 *   - server/src/services/ai/memory/threadMemory.js (mergeRollingSummary /
 *     buildSemanticSummary / sanitizeDurableTurnText)
 *   - server/src/services/ai/runtime/responseComposerBridge.js (buildResponse)
 * No test-specific summary logic is reimplemented here.
 */
const assert = require("node:assert/strict");

const {
  mergeRollingSummary,
  buildSemanticSummary,
  sanitizeDurableTurnText,
  MAX_ROLLING_SUMMARY_CHARS,
} = require("../server/src/services/ai/memory/threadMemory");
const {
  emptyWorkingMemory,
  updateWorkingMemory,
} = require("../server/src/services/ai/memory/workingMemory");
const { buildResponse } = require("../server/src/services/ai/runtime/responseComposerBridge");

let count = 0;
function ok(label) {
  count += 1;
  console.log(`  ok ${String(count).padStart(2, "0")} - ${label}`);
}

const FUTURE = Date.now() + 30 * 60 * 1000;
const PAST = Date.now() - 60 * 1000;

// ---------------------------------------------------------------------------
// M3-1: no previousSummary — structured fragments render alone (first turn).
// ---------------------------------------------------------------------------
{
  const summary = mergeRollingSummary("", {
    currentTurnFragments: {
      completedTools: [{ name: "search_empty_rooms", status: "success", verified: true, conclusion: "找到3间空教室" }],
      verificationSummary: { ok: true },
      pendingClarification: { type: "missing_week", missing: "teachingWeek" },
      stableFacts: ["campus=仙溪校区"],
      workingStateDelta: { goal: "find_empty_room", outcomeSummary: "已给出空教室候选" },
    },
  });
  assert.ok(summary.includes("待补充：teachingWeek"), "pending clarification rendered");
  assert.ok(summary.includes("已确认：campus=仙溪校区"), "stable fact rendered");
  assert.ok(summary.includes("当前目标：find_empty_room"), "goal rendered");
  assert.ok(summary.includes("search_empty_rooms成功（已核验：找到3间空教室）"), "verified tool conclusion rendered");
  assert.ok(summary.includes("最近结果：已给出空教室候选"), "outcome rendered");
  assert.ok(summary.length <= MAX_ROLLING_SUMMARY_CHARS, "within budget");
  ok("M3 无 previousSummary 路径：结构化 fragments 完整渲染");
}

// ---------------------------------------------------------------------------
// M3-2: with previousSummary — completedTools / pendingClarification survive
// the merge (the original defect: they were dropped from round 2 onward).
// ---------------------------------------------------------------------------
{
  const first = mergeRollingSummary("", {
    currentTurnFragments: {
      completedTools: [{ name: "search_empty_rooms", status: "success", verified: true, conclusion: "找到3间空教室" }],
      verificationSummary: { ok: true },
      pendingClarification: { type: "missing_week", missing: "teachingWeek" },
      stableFacts: ["campus=仙溪校区"],
      workingStateDelta: { goal: "find_empty_room" },
    },
  });
  const second = mergeRollingSummary(first, {
    currentTurnFragments: {
      completedTools: [{ name: "get_teaching_week", status: "success" }],
      pendingClarification: { type: "missing_week", missing: "teachingWeek" },
      workingStateDelta: { goal: "find_empty_room" },
    },
  });
  assert.ok(second.includes("search_empty_rooms成功（已核验：找到3间空教室）"), "round-1 tool trajectory kept");
  assert.ok(second.includes("get_teaching_week成功"), "round-2 tool added");
  assert.ok(second.includes("待补充：teachingWeek"), "unresolved pending kept across merge");
  assert.ok(second.includes("已确认：campus=仙溪校区"), "stable fact kept across merge");
  ok("M3 有 previousSummary 路径：completedTools 与 pendingClarification 不丢");
}

// ---------------------------------------------------------------------------
// M3-3: pendingClarification lifecycle — answered => removed (structured null),
// a new pending supersedes the old one.
// ---------------------------------------------------------------------------
{
  const withPending = mergeRollingSummary("", {
    currentTurnFragments: {
      pendingClarification: { type: "missing_week", missing: "teachingWeek" },
      workingStateDelta: { goal: "get_week_schedule" },
    },
  });
  assert.ok(withPending.includes("待补充：teachingWeek"));
  const answered = mergeRollingSummary(withPending, {
    currentTurnFragments: { pendingClarification: null, workingStateDelta: { goal: "get_week_schedule" } },
  });
  assert.ok(!answered.includes("待补充"), "resolved clarification removed");
  const superseded = mergeRollingSummary(withPending, {
    currentTurnFragments: {
      pendingClarification: { type: "missing_target", missing: "className" },
      workingStateDelta: { goal: "get_week_schedule" },
    },
  });
  assert.ok(superseded.includes("待补充：className"), "new pending rendered");
  assert.ok(!superseded.includes("teachingWeek"), "old pending superseded");
  ok("M3 pendingClarification：回答后 resolved 移除、新 pending supersede 旧");
}

// ---------------------------------------------------------------------------
// M3-4: pendingAction lifecycle — awaiting_receipt kept; completed / cancelled
// / expired / natural-language statuses are never pending (ActionReceipt-driven,
// no NL guessing).
// ---------------------------------------------------------------------------
{
  const base = {
    stableFacts: ["campus=仙溪校区"],
    workingStateDelta: { goal: "set_schedule_reminder" },
  };
  const withAction = mergeRollingSummary("", {
    currentTurnFragments: Object.assign({}, base, {
      pendingAction: { command: "setCurrentSchedule", status: "awaiting_receipt", expiresAt: FUTURE, target: { name: "25动医6班" } },
    }),
  });
  assert.ok(withAction.includes("待处理：setCurrentSchedule（25动医6班）"), "open action kept");
  for (const [status, label] of [["completed", "完成"], ["cancelled", "取消"]]) {
    const next = mergeRollingSummary(withAction, {
      currentTurnFragments: Object.assign({}, base, {
        pendingAction: { command: "setCurrentSchedule", status },
      }),
    });
    assert.ok(!next.includes("待处理"), `${label}的 action 不得待处理`);
  }
  const expired = mergeRollingSummary(withAction, {
    currentTurnFragments: Object.assign({}, base, {
      pendingAction: { command: "setCurrentSchedule", status: "awaiting_receipt", expiresAt: PAST },
    }),
  });
  assert.ok(!expired.includes("待处理"), "已过期的 action 不得待处理");
  const nlStatus = mergeRollingSummary(withAction, {
    currentTurnFragments: Object.assign({}, base, {
      pendingAction: { command: "setCurrentSchedule", status: "用户已经确认完了" },
    }),
  });
  assert.ok(!nlStatus.includes("待处理"), "非结构化/自然语言状态 fail-closed 不待处理");
  const cleared = mergeRollingSummary(withAction, {
    currentTurnFragments: Object.assign({}, base, { pendingAction: null }),
  });
  assert.ok(!cleared.includes("待处理"), "Receipt 提交后 pendingAction:null 移除");
  ok("M3 pendingAction：完成/取消/过期/非结构化状态均不待处理");
}

// ---------------------------------------------------------------------------
// M3-5: completed !== verified — failed verification never records a tool as
// confirmed success; missing verification evidence never earns 已核验.
// ---------------------------------------------------------------------------
{
  const failedVerification = mergeRollingSummary("", {
    currentTurnFragments: {
      completedTools: [{ name: "get_week_schedule", status: "success", verified: true, conclusion: "课表已核对" }],
      verificationSummary: { ok: false },
    },
  });
  assert.ok(!failedVerification.includes("已核验"), "verification 失败不得出现已核验结论");
  assert.ok(!failedVerification.includes("成功"), "verification 失败的工具不得记为已确认成功");
  assert.ok(failedVerification.includes("get_week_schedule已完成"), "工具可 completed 不可 verified");

  const noEvidence = mergeRollingSummary("", {
    currentTurnFragments: {
      completedTools: [{ name: "get_week_schedule", status: "success", verified: true, conclusion: "课表已核对" }],
    },
  });
  assert.ok(!noEvidence.includes("已核验"), "无 verification 通过证据不得出现已核验");

  for (const bad of [{ ok: null }, { ok: "true" }, { ok: 1 }, { status: "verified" }]) {
    const summary = mergeRollingSummary("", {
      currentTurnFragments: {
        completedTools: [{ name: "get_week_schedule", status: "success", verified: true, conclusion: "课表已核对" }],
        verificationSummary: bad,
      },
    });
    assert.ok(!summary.includes("已核验"), `verification ${JSON.stringify(bad)} 不得视为通过`);
  }
  ok("M3 completed≠verified：Verification 失败/缺证据不记成功");
}

// ---------------------------------------------------------------------------
// M3-6: repeated identical tool trajectory across turns never duplicates.
// ---------------------------------------------------------------------------
{
  let summary = "";
  for (let turn = 1; turn <= 5; turn += 1) {
    summary = mergeRollingSummary(summary, {
      currentTurnFragments: {
        completedTools: [{ name: "get_teaching_week", status: "success" }],
        workingStateDelta: { goal: "get_teaching_week", outcomeSummary: `第${turn}轮已回答` },
      },
    });
  }
  const occurrences = summary.split("get_teaching_week成功").length - 1;
  assert.strictEqual(occurrences, 1, "同一工具多轮只保留最新一条轨迹");
  assert.ok(summary.length <= MAX_ROLLING_SUMMARY_CHARS);
  ok("M3 多轮相同工具轨迹不无限重复");
}

// ---------------------------------------------------------------------------
// M3-7: "不是A是B" — only B survives, A removed/superseded (keyed + explicit).
// ---------------------------------------------------------------------------
{
  const keyed = mergeRollingSummary("已确认：preferredBuilding=A1。", {
    currentTurnFragments: { stableFacts: ["preferredBuilding=B2"] },
  });
  assert.ok(keyed.includes("preferredBuilding=B2"), "B 保留");
  assert.ok(!keyed.includes("A1"), "同 key 旧值被取代");

  const explicit = mergeRollingSummary("已确认：常用校区是江湾校区。", {
    currentTurnFragments: {
      stableFacts: ["常用校区是仙溪校区"],
      supersededFacts: ["常用校区是江湾校区"],
    },
  });
  assert.ok(explicit.includes("仙溪校区"), "B 保留");
  assert.ok(!explicit.includes("江湾校区"), "显式 supersededFacts 移除 A");
  ok("M3 “不是A是B”只留 B，A 被移除/supersede");
}

// ---------------------------------------------------------------------------
// M3-8 + M3-9: budget 1200 with deterministic priority trimming — unresolved
// pending > stable facts > goal > verified tool conclusions > recent context.
// Low-priority segments are dropped whole; the pass never relies on padding
// length to slip through.
// ---------------------------------------------------------------------------
{
  const facts = Array.from({ length: 15 }, (_, index) => (
    `factKey${String(index).padStart(2, "0")}=${"事实内容".repeat(18)}`
  ));
  const summary = mergeRollingSummary("", {
    currentTurnFragments: {
      pendingClarification: { missing: "teachingWeek" },
      stableFacts: facts,
      completedTools: [{ name: "search_empty_rooms", status: "success", verified: true, conclusion: "找到3间空教室" }],
      verificationSummary: { ok: true },
      workingStateDelta: {
        goal: "find_empty_room",
        outcomeSummary: "本轮已给出空教室候选列表",
        recentContext: ["最近上下文".repeat(40)],
      },
    },
  });
  assert.ok(summary.length <= MAX_ROLLING_SUMMARY_CHARS, "硬预算 1200 不突破");
  assert.ok(summary.includes("待补充：teachingWeek"), "未解决 clarification 优先级最高，完整保留");
  assert.ok(summary.includes("factKey14="), "最新稳定事实保留");
  assert.ok(!summary.includes("factKey00="), "最旧稳定事实按优先级最后被裁");
  assert.ok(!summary.includes("最近上下文"), "最近上下文最先被裁");
  assert.ok(!summary.includes("最近结果"), "最近结果先于工具结论被裁");
  assert.ok(!summary.includes("工具轨迹"), "工具结论先于目标被裁");
  ok("M3 预算 1200 按优先级截断（非加长度假过：低优段整体被裁、高优完整）");

  const huge = mergeRollingSummary("", {
    currentTurnFragments: {
      pendingClarification: { missing: "weekday" },
      stableFacts: Array.from({ length: 20 }, (_, index) => `k${String(index).padStart(2, "0")}=${"长事实".repeat(25)}`),
    },
  });
  assert.ok(huge.length <= MAX_ROLLING_SUMMARY_CHARS, "极端输入仍不超预算");
  assert.ok(huge.includes("待补充：weekday"), "极端输入下 pending 仍完整");
  assert.ok(huge.includes("k19="), "极端输入下最新事实保留");
  assert.ok(!huge.includes("k00="), "极端输入下最旧事实被裁");
  ok("M3 极端超预算输入：pending 完整、长度达标、非简单尾部截断");
}

// ---------------------------------------------------------------------------
// M3-10: tool trajectory never stores raw responses / full schedules / hidden
// reasoning — conclusions are sanitized and hard-capped.
// ---------------------------------------------------------------------------
{
  const rawJson = '{"success":true,"data":{"courses":[{"name":"解剖学"}]}}';
  const snapshot = [
    "星期一 第1-2节 课程A 教室A101",
    "星期二 第3-4节 课程B 教室B202",
    "星期三 第5-6节 课程C 教室C303",
    "星期四 第7-8节 课程D 教室D404",
  ].join("\n");
  const hiddenReasoning = `隐藏推理：${"因为所以".repeat(80)}，最终结论是可以`;
  const summary = mergeRollingSummary("", {
    currentTurnFragments: {
      completedTools: [
        { name: "get_week_schedule", status: "success", verified: true, conclusion: rawJson },
        { name: "search_empty_rooms", status: "success", verified: true, conclusion: snapshot },
        { name: "get_teaching_week", status: "success", verified: true, conclusion: hiddenReasoning },
      ],
      verificationSummary: { ok: true },
    },
  });
  assert.ok(!summary.includes("解剖学") && !summary.includes("courses"), "原始工具结果不得入摘要");
  assert.ok(!summary.includes("A101") && !summary.includes("课程A"), "完整课表快照不得入摘要");
  assert.ok(!summary.includes("最终结论是可以"), "隐藏推理长文被硬截断，不得完整入摘要");
  assert.ok(!summary.includes(rawJson), "原始 JSON 原文不得出现");
  ok("M3 工具轨迹不存原始响应/完整课表/隐藏推理");
}

// ---------------------------------------------------------------------------
// M3-11: early confirmed stable facts remain referenceable after 100 turns.
// ---------------------------------------------------------------------------
{
  let summary = mergeRollingSummary("", {
    currentTurnFragments: {
      stableFacts: ["preferredName=小佛同学"],
      workingStateDelta: { goal: "set_preference", outcomeSummary: "用户确认称呼" },
    },
  });
  for (let turn = 2; turn <= 100; turn += 1) {
    summary = mergeRollingSummary(summary, {
      currentTurnFragments: {
        workingStateDelta: {
          goal: turn % 2 ? "small_talk" : "project_qa",
          outcomeSummary: `第${turn}轮已完成`,
        },
      },
    });
  }
  assert.ok(summary.includes("preferredName=小佛同学"), "100 Turn 后早期有效稳定事实仍可引用");
  assert.ok(summary.length <= MAX_ROLLING_SUMMARY_CHARS);
  ok("M3 100 Turn 后早期有效稳定事实可引用");
}

// ---------------------------------------------------------------------------
// M3-12: expired / superseded content never shows up.
// ---------------------------------------------------------------------------
{
  const expiredPending = mergeRollingSummary("", {
    currentTurnFragments: {
      pendingClarification: { type: "missing_week", missing: "teachingWeek", expiresAt: PAST },
      pendingAction: { command: "setCurrentSchedule", status: "awaiting_receipt", expiresAt: PAST },
      stableFacts: ["campus=仙溪校区"],
    },
  });
  assert.ok(!expiredPending.includes("待补充"), "过期 clarification 不出现");
  assert.ok(!expiredPending.includes("待处理"), "过期 action 不出现");

  let summary = mergeRollingSummary("已确认：preferredBuilding=A1。待补充：teachingWeek。", {
    currentTurnFragments: {
      pendingClarification: { type: "missing_week", missing: "teachingWeek", expiresAt: PAST },
      supersededFacts: ["preferredBuilding=A1"],
      stableFacts: ["campus=仙溪校区"],
    },
  });
  assert.ok(!summary.includes("A1"), "superseded 旧事实不出现");
  assert.ok(!summary.includes("待补充"), "过期 pending 从旧摘要中移除");
  assert.ok(summary.includes("campus=仙溪校区"), "有效事实保留");
  ok("M3 过期/superseded 内容不出现");
}

// ---------------------------------------------------------------------------
// M3-13: no English placeholders in system-generated defaults.
// ---------------------------------------------------------------------------
{
  const raw = sanitizeDurableTurnText('{"success":true,"data":{"secretFact":"raw"}}', {
    role: "assistant", toolNames: [], intentName: "general_assistant",
  });
  assert.strictEqual(raw, "[原始工具结果未保留]");
  const snapshot = sanitizeDurableTurnText([
    "星期一 第1-2节 课程A 教室A101",
    "星期二 第3-4节 课程B 教室B202",
    "星期三 第5-6节 课程C 教室C303",
    "星期四 第7-8节 课程D 教室D404",
  ].join("\n"), { role: "assistant", toolNames: ["get_week_courses"], intentName: "get_week_schedule" });
  assert.strictEqual(snapshot, "[课表快照未保留，将由权威工具重新查询]");
  const weather = sanitizeDurableTurnText("Tomorrow is 34C with 80% rain", {
    role: "assistant", toolNames: ["get_campus_weather"], intentName: "weather_lookup",
  });
  assert.strictEqual(weather, "[天气结果具有时效性，未保留]");
  const authoritative = sanitizeDurableTurnText("当前教学周为第8周，本学期共20周。", {
    role: "assistant", toolNames: ["get_today_courses"], intentName: "get_today_courses",
  });
  assert.strictEqual(authoritative, "[权威校园事实结果未保留，将由工具重新查询]");
  assert.ok(![raw, snapshot, weather, authoritative].join("").includes("not retained"), "系统占位符无英文");
  ok("M3 系统生成默认文本统一自然中文，无英文占位符");
}

// ---------------------------------------------------------------------------
// M3-14: real English course names / proper nouns / user originals untouched;
// production path (buildSemanticSummary over real working memory) end-to-end.
// ---------------------------------------------------------------------------
{
  const userOriginal = "My favorite course is English 101 this semester";
  assert.strictEqual(
    sanitizeDurableTurnText(userOriginal, { role: "user" }),
    userOriginal,
    "用户英文原文不受影响"
  );

  // Production path: working memory -> buildSemanticSummary -> merge, two turns.
  const turn1Working = updateWorkingMemory(emptyWorkingMemory(), {
    message: "查25动医6班课表",
    intentName: "get_week_schedule",
    slots: { className: "25动医6班" },
    executedTools: ["get_week_courses"],
    observations: [{ tool: "get_week_courses", status: "success", summary: "权威课表结果已返回", factCount: 3 }],
    pendingClarification: { intentName: "get_week_schedule", type: "missing_week", missing: "teachingWeek", createdAt: Date.now(), expiresAt: FUTURE },
  });
  const summary1 = buildSemanticSummary({
    intentName: "get_week_schedule",
    workingMemory: turn1Working,
    completedTools: ["get_week_courses"],
    resultSummary: "请补充要查询的教学周",
  });
  assert.ok(summary1.includes("待补充：teachingWeek"), "生产路径 pending 入摘要");
  assert.ok(summary1.includes("get_week_courses成功"), "生产路径工具轨迹入摘要");
  assert.ok(summary1.includes("已确认：班级 25动医6班"), "生产路径稳定事实入摘要");

  const turn2Working = updateWorkingMemory(turn1Working, {
    message: "第8周",
    intentName: "get_week_schedule",
    slots: { week: 8 },
    pendingClarification: null,
    executedTools: ["get_week_courses"],
    observations: [{ tool: "get_week_courses", status: "success", summary: "第8周课表已返回", factCount: 3 }],
  });
  const summary2 = buildSemanticSummary({
    previousSummary: summary1,
    intentName: "get_week_schedule",
    workingMemory: turn2Working,
    completedTools: ["get_week_courses"],
    resultSummary: "第8周课表已给出",
  });
  assert.ok(!summary2.includes("待补充"), "生产路径：用户回答后 pending 移除");
  assert.strictEqual(summary2.split("get_week_courses成功").length - 1, 1, "生产路径：工具轨迹不重复");
  assert.ok(summary2.includes("25动医6班") && summary2.includes("第8周"), "生产路径：稳定事实跨轮保留并更新");
  assert.ok(summary2.length <= MAX_ROLLING_SUMMARY_CHARS);
  ok("M3 真实生产实现端到端：buildSemanticSummary 两轮合并语义正确");
}

// ---------------------------------------------------------------------------
// M3-15: legacy caller shape ({confirmedFacts, corrections, goal,
// outcomeSummary}) normalizes into the same pipeline — no second builder.
// ---------------------------------------------------------------------------
{
  let summary = mergeRollingSummary("", {
    confirmedFacts: ["preferredName=小佛同学"],
    goal: "set_preference",
    outcomeSummary: "用户确认称呼",
  });
  assert.ok(summary.includes("已确认：preferredName=小佛同学"));
  summary = mergeRollingSummary(summary, { goal: "project_qa", outcomeSummary: "已回答" });
  assert.ok(summary.includes("preferredName=小佛同学"), "legacy 入参走同一合并管线，事实保留");
  assert.ok(summary.includes("当前目标：project_qa"));
  ok("M3 legacy 调用形状归一到同一结构化管线");
}

// ---------------------------------------------------------------------------
// M3-16: summaries rendered by the OLD label set (还缺少/用户正在/已完成工具/
// 用户纠正/当前结果) parse back cleanly — no orphaned punctuation, tools keep
// merging by name.
// ---------------------------------------------------------------------------
{
  const legacyRendered = "还缺少：teachingWeek。已确认：campus=仙溪校区。用户纠正：preferredBuilding=B2。用户正在：find_empty_room。已完成工具：get_week_courses、get_teaching_week。当前结果：已回答。";
  const merged = mergeRollingSummary(legacyRendered, {
    currentTurnFragments: {
      pendingClarification: null,
      completedTools: [{ name: "get_week_courses", status: "success" }],
      workingStateDelta: { goal: "get_week_schedule" },
    },
  });
  assert.ok(!merged.includes("待补充"), "旧“还缺少”段在 resolved 后移除");
  assert.ok(merged.includes("已确认：campus=仙溪校区"), "旧稳定事实保留");
  assert.ok(merged.includes("preferredBuilding=B2"), "旧“用户纠正”并入稳定事实");
  assert.ok(!merged.includes("：preferredBuilding"), "解析不残留前导冒号");
  assert.ok(merged.includes("当前目标：get_week_schedule"), "旧“用户正在”目标被替换");
  assert.ok(merged.includes("get_week_courses成功"), "旧“已完成工具”条目按名合并更新");
  assert.ok(merged.includes("get_teaching_week"), "未提及的旧工具轨迹保留");
  assert.ok(!/；：|、：/.test(merged), "解析不残留前导冒号条目");
  assert.strictEqual(merged.split("get_week_courses").length - 1, 1, "工具不重复");
  ok("M3 旧标签摘要 round-trip 解析干净");
}

// ---------------------------------------------------------------------------
// Low#6-1: buildResponse verification fail-closed — only ok === true passes.
// ---------------------------------------------------------------------------
{
  const basePayload = {
    runtimeMode: "trial",
    intent: { name: "get_teaching_week", confidence: 1, slots: {} },
    answer: "当前是第8周。",
    toolCalls: [{ name: "get_teaching_week", status: "success", summary: "ok", result: { success: true, currentWeek: 8 } }],
  };
  for (const bad of [{ evidenceComplete: true }, { ok: null }, { ok: "true" }, { ok: 1 }, { ok: false }]) {
    const response = buildResponse(Object.assign({}, basePayload, { verification: bad }));
    assert.strictEqual(response.verification.ok, false, `verification ${JSON.stringify(bad)} 不得视为通过`);
  }
  for (const missing of [undefined, null, "weird", 42]) {
    const response = buildResponse(Object.assign({}, basePayload, { verification: missing }));
    assert.strictEqual(response.verification, null, "verification 缺失/结构非法 => null（不通过）");
    assert.strictEqual(response.status, "completed", "无通过证据仍可 completed（不可 verified）");
  }
  ok("Low#6 缺 ok / ok 非布尔 true / 结构非法均不通过");
}

// ---------------------------------------------------------------------------
// Low#6-2: verifier-exception shape (coordinator folds throws into ok:false)
// stays failed through buildResponse; ok:true paths (v1 + v2) do not regress.
// ---------------------------------------------------------------------------
{
  const basePayload = {
    runtimeMode: "trial",
    intent: { name: "get_teaching_week", confidence: 1, slots: {} },
    answer: "当前是第8周。",
    toolCalls: [{ name: "get_teaching_week", status: "success", summary: "ok", result: { success: true, currentWeek: 8 } }],
  };
  const exceptionFolded = buildResponse(Object.assign({}, basePayload, {
    verification: { ok: false, errors: [{ code: "VERIFIER_RUNTIME_ERROR" }] },
  }));
  assert.strictEqual(exceptionFolded.verification.ok, false, "verifier 异常（fail-closed 为 ok:false）不得通过");

  const passed = buildResponse(Object.assign({}, basePayload, { verification: { ok: true, errors: [] } }));
  assert.strictEqual(passed.verification.ok, true, "ok:true 正常路径不回归（v1）");

  const passedV2 = buildResponse(Object.assign({}, basePayload, {
    protocolVersion: "agent.v2",
    verification: { ok: true, errors: [] },
  }));
  assert.strictEqual(passedV2.verification.ok, true, "ok:true 正常路径不回归（v2）");
  const missingOkV2 = buildResponse(Object.assign({}, basePayload, {
    protocolVersion: "agent.v2",
    verification: { evidenceComplete: true },
  }));
  assert.strictEqual(missingOkV2.verification.ok, false, "v2 缺 ok 同样 fail-closed");
  ok("Low#6 verifier 异常不通过；ok:true（v1/v2）不回归");
}

console.log(`test-agent-rolling-summary: PASS (${count} cases)`);
