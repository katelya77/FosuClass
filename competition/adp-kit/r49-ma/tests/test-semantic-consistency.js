"use strict";
// R49.2 新增测试：业务语义一致性（12 项语义断言 + ADP 0 值掩码回归）
//
// 背景（2026-08-17 诊断结论）：
// 腾讯 ADP 平台会把缺失的可选整数参数归一化为 0（weekday:0 / periodStart:0 / periodEnd:0）。
// 旧版 Runtime 只处理了 weekday=0，periodStart/periodEnd=0 被当作真实节次约束 [0,0]，
// 把全部课程过滤成空结果 → campus_risk_check(self, T09, week1) 曾误报无风险，
// 与 campus_overview 的冲突事实不一致。
//
// 本测试直接驱动 **CloudBase 部署同源运行时**（cloudfunctions/campusflowAdpTools 的
// Agent Tool Façade → CampusTools），不经过仓库 adapter，验证真正上线路径的语义。
// 断言只使用 competition-demo-v2 真实数据派生的事实；teacher-009 / lesson-0xx 等
// ID 仅在本测试中作为断言锚点，运行时算法必须保持通用（不得在工具代码硬编码）。

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");
process.env.CAMPUS_DATA_PATH = V2_PATH;

const { callAgentTool } = require("../../cloudfunctions/campusflowAdpTools/src/agent-tools.js");
const { callTool } = require("../../cloudfunctions/campusflowAdpTools/src/tools.js");

const EXPECTED_DATA_VERSION = "competition-demo-v2";
const EXPECTED_DATA_HASH = "sha1:4f3bbbb45d1f";
const DEMO_USER_ID = "user-demo-001";

function riskSelf(type, name, extra) {
  return callAgentTool("campus_risk_check", Object.assign(
    { mode: "self", entityType: type, entityName: name, week: 1 },
    extra,
  ));
}

// ---------------------------------------------------------------------------
// 1. schedule positive：T09 第 1 周有 6 节课（lesson-032 从第 2 周开始，不在其中）
// ---------------------------------------------------------------------------
test("1. campus_schedule_query 正向：T09 week=1 返回 6 节课且含 lesson-015/018/051", () => {
  const env = callAgentTool("campus_schedule_query", {
    entityType: "teacher", entityName: "T09", week: 1,
  });
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.dataVersion, EXPECTED_DATA_VERSION);
  assert.strictEqual(env.evidence.dataHash, EXPECTED_DATA_HASH);
  assert.strictEqual(env.evidence.verified, true);
  assert.strictEqual(env.resolvedEntity.name, "教师009");
  assert.strictEqual(env.items.length, 6, "T09 第 1 周应为 6 节课");
  const ids = env.items.map((i) => i.lessonId).sort();
  for (const want of ["lesson-015", "lesson-018", "lesson-021", "lesson-037", "lesson-051", "lesson-052"]) {
    assert.ok(ids.includes(want), `应包含 ${want}`);
  }
});

// ---------------------------------------------------------------------------
// 2. schedule 真 EMPTY_RESULT：T09 第 1 周周六无课（合法空结果，非接口失败）
// ---------------------------------------------------------------------------
test("2. campus_schedule_query 真 EMPTY_RESULT：T09 week=1 weekday=6 无课", () => {
  const env = callAgentTool("campus_schedule_query", {
    entityType: "teacher", entityName: "T09", week: 1, weekday: 6,
  });
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.items.length, 0);
  assert.strictEqual(env.evidence.note, "EMPTY_RESULT");
  assert.strictEqual(env.error, null);
});

// ---------------------------------------------------------------------------
// 3. classroom positive：校区A 2026-09-03 第5-6节 60 人以上
// ---------------------------------------------------------------------------
test("3. campus_classroom_search 正向：校区A 2026-09-03 5-6节 minCapacity=60", () => {
  const env = callAgentTool("campus_classroom_search", {
    campus: "校区A", date: "2026-09-03", periodStart: 5, periodEnd: 6, minCapacity: 60,
  });
  assert.strictEqual(env.success, true);
  assert.ok(env.items.length > 0, "应存在空教室");
  for (const it of env.items) {
    assert.strictEqual(it.campusName, "校区A");
    assert.ok(it.capacity >= 60, `容量 ${it.capacity} 应 >= 60`);
    assert.strictEqual(it.freePeriodStart, 5);
    assert.strictEqual(it.freePeriodEnd, 6);
  }
});

// ---------------------------------------------------------------------------
// 4. risk SELF 有风险：T09 第 1 周 = 1 冲突（lesson-018 vs lesson-051）+ 1 赶场
// ---------------------------------------------------------------------------
test("4. campus_risk_check SELF 有风险：T09 week=1 冲突+赶场均≥1", () => {
  const env = riskSelf("teacher", "T09");
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.summary.selfCompare, true);
  assert.strictEqual(env.summary.conflictCount, 1);
  assert.strictEqual(env.summary.rushWarningCount, 1);
  assert.strictEqual(env.summary.hasConflict, true);
  assert.strictEqual(env.evidence.verified, true);
  const c = env.items[0];
  assert.strictEqual(c.date, "2026-09-02", "冲突发生在 周三 2026-09-02");
  assert.strictEqual(c.periodStart, 5);
  assert.strictEqual(c.periodEnd, 6);
  assert.deepStrictEqual(
    [c.first.lessonId, c.second.lessonId].sort(),
    ["lesson-018", "lesson-051"],
    "SELF 冲突对应为 lesson-018 / lesson-051",
  );
  const r = env.rushWarnings[0];
  assert.strictEqual(r.from.lessonId, "lesson-051");
  assert.strictEqual(r.to.lessonId, "lesson-052");
  assert.strictEqual(r.gapMinutes, 20);
});

// ---------------------------------------------------------------------------
// 5. risk SELF 无风险：教师001 第 1 周无冲突无赶场
// 「未发现风险」是已核验的确定性结论，由 summary 计数表达，绝不是 EMPTY_RESULT。
// ---------------------------------------------------------------------------
test("5. campus_risk_check SELF 无风险：教师001 week=1 为成功已核验结论（非 EMPTY_RESULT）", () => {
  const env = riskSelf("teacher", "教师001");
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.summary.conflictCount, 0);
  assert.strictEqual(env.summary.rushWarningCount, 0);
  assert.strictEqual(env.summary.hasConflict, false);
  assert.notStrictEqual(env.evidence.note, "EMPTY_RESULT");
});

// ---------------------------------------------------------------------------
// 6. risk COMPARE：T03 vs T09（显式双对象）
// ---------------------------------------------------------------------------
test("6. campus_risk_check COMPARE：T03 vs T09 week=1 selfCompare=false", () => {
  const env = callAgentTool("campus_risk_check", {
    mode: "compare",
    entityType: "teacher", entityName: "T03",
    secondEntityType: "teacher", secondEntityName: "T09",
    week: 1,
  });
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.summary.selfCompare, false);
  assert.strictEqual(env.compared[0].name, "教师003");
  assert.strictEqual(env.compared[1].name, "教师009");
  assert.ok(env.summary.firstBusySlots > 0 && env.summary.secondBusySlots > 0, "双方都应加载到课");
  assert.ok(typeof env.summary.hasConflict === "boolean");
});

// ---------------------------------------------------------------------------
// 7. day_plan date-only 正向：visitorId 缺失时服务端确定性补齐 demoUsers[0].id
// ---------------------------------------------------------------------------
test("7. campus_day_plan date-only 正向：2026-09-04 课程=3 无跨校区", () => {
  const env = callAgentTool("campus_day_plan", { date: "2026-09-04" });
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.resolvedEntity.id, DEMO_USER_ID, "visitorId 缺失应确定性补齐 user-demo-001");
  assert.strictEqual(env.resolvedEntity.name, "演示用户001");
  assert.strictEqual(env.summary.lessonCount, 3);
  assert.strictEqual(env.summary.hasCrossCampus, false);
  assert.strictEqual(env.evidence.verified, true);
  const names = env.items.filter((i) => i.type === "lesson").map((i) => i.courseName);
  assert.ok(names.includes("数据结构基础"), "应含 数据结构基础");
  const db = env.items.find((i) => i.type === "lesson" && i.courseName === "数据结构基础");
  assert.strictEqual(db.periodText, "第5-6节");
  assert.strictEqual(db.roomName, "A2-110");
});

// ---------------------------------------------------------------------------
// 8. day_plan preferredStudyDuration=2 正向：自习空档按 2 节截断
// ---------------------------------------------------------------------------
test("8. campus_day_plan preferredStudyDuration=2 正向：空档按 2 节截断", () => {
  const env = callAgentTool("campus_day_plan", { date: "2026-08-31", preferredStudyDuration: 2 });
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.summary.lessonCount, 3);
  const gaps = env.items.filter((i) => i.type === "gap");
  assert.ok(gaps.length > 0, "2026-08-31 应有空闲时段（第3-4节）");
  const gap = gaps[0];
  assert.strictEqual(gap.periodStart, 3);
  assert.strictEqual(gap.periodEnd, 4);
  assert.ok(gap.periodEnd - gap.periodStart + 1 <= 2, `gap 长度 ${gap.periodStart}-${gap.periodEnd} 应 ≤ 2 节`);
  assert.ok(Array.isArray(gap.studyRooms) && gap.studyRooms.length > 0, "应给出自习教室建议");
});

// ---------------------------------------------------------------------------
// 9. day_plan preferredStudyDuration=0 → INVALID_PARAM fail-closed（禁止删除该校验）
// ---------------------------------------------------------------------------
test("9. campus_day_plan preferredStudyDuration=0 必须 INVALID_PARAM fail-closed", () => {
  const env = callAgentTool("campus_day_plan", { date: "2026-09-04", preferredStudyDuration: 0 });
  assert.strictEqual(env.success, false);
  assert.strictEqual(env.error.code, "INVALID_PARAM");
  assert.ok(env.error.message.includes("1-10"), `错误信息应说明 1-10 节: ${env.error.message}`);
});

// ---------------------------------------------------------------------------
// 10. overview 正向：完整 4 周矩阵 / 资源 / Top / 峰值 / 风险，且数据版本锚定
// ---------------------------------------------------------------------------
test("10. campus_overview 正向：{} 返回完整态势且 dataHash 锚定", () => {
  const env = callAgentTool("campus_overview", {});
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.evidence.dataHash, EXPECTED_DATA_HASH);
  assert.strictEqual(env.evidence.verified, true);
  const item = env.items[0];
  assert.strictEqual(item.matrix.length, 4);
  assert.ok(item.campusResources.length >= 1);
  assert.ok(item.teacherLoadTop.length === 3);
  assert.ok(item.peakSlot);
  assert.strictEqual(item.risks.conflictCount, 19);
  assert.strictEqual(item.risks.rushCount, 23);
  assert.strictEqual(env.summary.weekCount, 4);
});

// ---------------------------------------------------------------------------
// 11. risk ↔ overview 语义一致性不变量（通用，不依赖任何硬编码实体）
//    同 dataVersion+dataHash 下：overview 第 1 周识别出的实体级风险事实，
//    在实体级 self-risk 查询中不得无理由消失。
// ---------------------------------------------------------------------------
test("11. risk ↔ overview 语义一致性不变量（第 1 周全量教师）", () => {
  const ov = callAgentTool("campus_overview", {});
  assert.strictEqual(ov.success, true);
  const risks = ov.items[0].risks;

  const w1Conflicts = risks.conflicts.filter((c) => c.week === 1);
  const w1Rush = risks.rushWarnings.filter((c) => c.week === 1);
  assert.ok(w1Conflicts.length > 0 && w1Rush.length > 0, "第 1 周必须存在冲突与赶场事实");

  // overview 冲突 pair → 涉及教师 → 该教师 self-risk 必须能复现同一对课次冲突
  const json = require("../../mock-data/competition-demo-v2.json");
  const byId = Object.fromEntries(json.lessons.map((l) => [l.id, l]));
  for (const c of w1Conflicts) {
    const [a, b] = c.lessonIds;
    // overview 冲突可能是「班级冲突/教室冲突」（sharedTeacherCount=0，教师不相交），
    // 这类事实只有班级/教室级视角可复现；仅当冲突双方共享教师时，
    // 该教师的 self-risk 必须复现同一对课次冲突。
    const sharedTeachers = byId[a].teacherIds.filter((tid) => byId[b].teacherIds.includes(tid));
    if (sharedTeachers.length === 0) continue;
    for (const tid of sharedTeachers) {
      const teacher = json.teachers.find((t) => t.id === tid);
      assert.ok(teacher, `overview 冲突教师 ${tid} 应存在`);
      const env = riskSelf("teacher", teacher.name);
      assert.strictEqual(env.success, true, `${teacher.name} self-risk 应成功`);
      const pairIds = [c.lessonIds[0], c.lessonIds[1]].sort();
      const found = env.items.some((conf) => (
        conf.weekday === c.weekday
        && conf.date === c.date
        && [conf.first.lessonId, conf.second.lessonId].sort().join("::") === pairIds.join("::")
      ));
      assert.ok(found, `${teacher.name} self-risk 必须复现 overview 冲突 ${pairIds.join(" vs ")} @${c.date}`);
    }
  }

  // overview 赶场事实 → 该教师 self-risk 必须能复现同一赶场对
  for (const r of w1Rush) {
    const teacher = json.teachers.find((t) => t.id === r.teacherId);
    assert.ok(teacher, `overview 赶场教师 ${r.teacherId} 应存在`);
    const env = riskSelf("teacher", teacher.name);
    assert.strictEqual(env.success, true);
    const found = env.rushWarnings.some((w) => (
      w.weekday === r.weekday
      && w.from.lessonId === r.fromLessonId
      && w.to.lessonId === r.toLessonId
      && w.gapMinutes === r.gapMinutes
    ));
    assert.ok(found, `${teacher.name} self-risk 必须复现 overview 赶场 ${r.fromLessonId}→${r.toLessonId}`);
  }
});

// ---------------------------------------------------------------------------
// 12. weekday=0 / periodStart=0 / periodEnd=0 兼容：视为未指定，不得解释成星期0/节次0
//    含腾讯 ADP 真实归一化载荷回归（2026-08-17 P0 根因）
// ---------------------------------------------------------------------------
test("12a. risk self 携带 ADP 全 0 载荷必须与最小输入等价（不得为空）", () => {
  const adpPayload = riskSelf("teacher", "T09", {
    weekday: 0, date: "", periodStart: 0, periodEnd: 0,
  });
  assert.strictEqual(adpPayload.success, true, "ADP 0 值载荷必须成功");
  assert.strictEqual(adpPayload.summary.conflictCount, 1, "0 值不得把冲突掩码为空");
  assert.strictEqual(adpPayload.summary.firstBusySlots, 6);
  assert.strictEqual(adpPayload.summary.rushWarningCount, 1);
  const minimal = riskSelf("teacher", "T09");
  assert.strictEqual(adpPayload.summary.conflictCount, minimal.summary.conflictCount);
  assert.strictEqual(adpPayload.summary.rushWarningCount, minimal.summary.rushWarningCount);
});

test("12b. schedule query 携带 weekday=0 / periodStart=0 / periodEnd=0 与最小输入等价", () => {
  const withZeros = callAgentTool("campus_schedule_query", {
    entityType: "teacher", entityName: "T09", week: 1, weekday: 0, periodStart: 0, periodEnd: 0,
  });
  const minimal = callAgentTool("campus_schedule_query", {
    entityType: "teacher", entityName: "T09", week: 1,
  });
  assert.strictEqual(withZeros.success, true);
  assert.strictEqual(withZeros.items.length, 6, "0 值不得把课表掩码为空（T09 周5 有 lesson-015）");
  assert.deepStrictEqual(
    withZeros.items.map((i) => i.lessonId).sort(),
    minimal.items.map((i) => i.lessonId).sort(),
  );
});

test("12c. classroom search 缺节次范围保持 fail-closed（0 值不得静默变成全时段）", () => {
  const env = callAgentTool("campus_classroom_search", {
    campus: "校区A", date: "2026-09-03", periodStart: 0, periodEnd: 0, minCapacity: 60,
  });
  assert.strictEqual(env.success, false);
  assert.strictEqual(env.error.code, "INVALID_PARAM");
});

// ---------------------------------------------------------------------------
// 附加：底层 compare_schedules 直接调用（诊断 Step 3 固化为回归）
// ---------------------------------------------------------------------------
test("附加. compare_schedules 底层直调：0 值归一化同样生效", () => {
  const env = callTool("compare_schedules", {
    firstType: "teacher", firstName: "T09",
    secondType: "teacher", secondName: "T09",
    week: 1, weekday: 0, date: "", periodStart: 0, periodEnd: 0,
  });
  assert.strictEqual(env.success, true);
  assert.strictEqual(env.summary.conflictCount, 1);
  assert.strictEqual(env.summary.selfCompare, true);
});

// ---------------------------------------------------------------------------
// 13. reschedule 可选 target.room 空值归一化：ADP 平台可能传 ""/"   "/[]，
//     一律表示「用户未指定教室」→ 自动候选查找，绝不允许「未找到教室「」」。
// ---------------------------------------------------------------------------
for (const [label, roomValue] of [["空字符串", ""], ["纯空白", "   "], ["空数组", []]]) {
  test(`13. campus_reschedule_feasibility target.room=${JSON.stringify(roomValue)}（${label}）与未指定等价`, () => {
    const absent = callAgentTool("campus_reschedule_feasibility", {
      sourceLessonId: "lesson-015", target: { week: 1, weekday: 3, periodStart: 1, periodEnd: 2 },
    });
    const withEmpty = callAgentTool("campus_reschedule_feasibility", {
      sourceLessonId: "lesson-015",
      target: { week: 1, weekday: 3, periodStart: 1, periodEnd: 2, room: roomValue },
    });
    assert.strictEqual(absent.success, true, `未指定 room 基线必须成功：${absent.error && absent.error.code}`);
    assert.strictEqual(withEmpty.success, true, `空值 room 不得报 ${withEmpty.error && withEmpty.error.code}`);
    assert.strictEqual(withEmpty.items[0].target.room, null, "空值 room 不得解析为虚假教室");
    assert.deepStrictEqual(
      withEmpty.items[0].checks.spaceAvailability.suggestedRoom,
      absent.items[0].checks.spaceAvailability.suggestedRoom,
      "空值 room 必须与未指定一样进入自动候选查找",
    );
    assert.strictEqual(withEmpty.simulation.mutatedData, false);
  });
}
