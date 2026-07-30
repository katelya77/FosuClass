#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createContextAssembler } = require("../packages/agent-runtime");
const { UserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");
const { mergeRollingSummary } = require("../server/src/services/ai/memory/threadMemory");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaofu-memory-scenarios-"));
  const secret = "unit-test-memory-scenarios-secret";
  const clock = { now: () => Date.parse("2026-07-30T08:00:00.000Z") };
  const assembler = createContextAssembler({ clock });
  let count = 0;
  const principal = (name) => ({
    authenticated: true,
    principalKey: `principal-${name}`,
  });
  const createService = () => new UserPreferenceService({
    dataDir: root,
    secret,
    clock,
  });
  const write = (service, owner, key, value, extra = {}) => service.upsertMemory({
    principal: owner,
    memoryMode: "cloud_sync",
    explicit: extra.explicit !== false,
    entry: {
      kind: extra.kind || "stable_preference",
      key,
      content: extra.content || `${key}=${value}`,
      normalizedValue: value,
      provenance: extra.provenance || {
        type: extra.correction ? "user_correction" : "user_explicit",
        turnId: `turn-${count + 1}`,
      },
      confidence: extra.confidence || 0.98,
      scope: extra.scope || "user",
      correction: extra.correction === true,
      termId: extra.termId || "",
      releaseVersion: extra.releaseVersion || "",
    },
  });

  try {
    // 1: an early confirmed fact survives 100 subsequent Turns via rolling summary.
    let summary = "";
    summary = mergeRollingSummary(summary, {
      confirmedFacts: ["preferredName=小佛同学"],
      goal: "set_preference",
      outcomeSummary: "用户确认称呼",
    });
    for (let turn = 2; turn <= 100; turn += 1) {
      summary = mergeRollingSummary(summary, {
        goal: turn % 2 ? "small_talk" : "project_qa",
        outcomeSummary: `第${turn}轮已完成`,
      });
    }
    const longConversation = await assembler.assemble({
      currentMessage: "我之前确认过你怎么称呼我？",
      recentMessages: Array.from({ length: 12 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `最近消息${index}`,
      })),
      rollingSummary: summary,
    });
    assert.ok(longConversation.rollingSummary.includes("preferredName=小佛同学"));
    const longTermOwner = principal("hundred-turn");
    write(createService(), longTermOwner, "preferredName", "XiaoFu", {
      kind: "identity_alias",
    });
    const restoredAfterHundredTurns = createService().retrieveMemories({
      principal: longTermOwner,
      query: "what name did I confirm",
      goal: "user_profile",
      limit: 3,
    });
    assert.strictEqual(restoredAfterHundredTurns.items[0].normalizedValue, "XiaoFu");
    count += 1;

    // 2-13: a new process/device restores an explicitly enabled cloud preference.
    for (let index = 0; index < 12; index += 1) {
      const owner = principal(`device-${index}`);
      write(createService(), owner, "preferredBuilding", `B${index + 1}`);
      const restored = createService().retrieveMemories({
        principal: owner,
        query: "我常用哪个楼栋自习？",
        goal: "find_empty_room",
        limit: 3,
      });
      assert.strictEqual(restored.items[0].normalizedValue, `B${index + 1}`);
      count += 1;
    }

    // 14-25: explicit “不是 A，是 B” corrections leave one active truth.
    for (let index = 0; index < 12; index += 1) {
      const service = createService();
      const owner = principal(`correction-${index}`);
      const before = write(service, owner, "preferredBuilding", `A${index + 1}`);
      const after = write(service, owner, "preferredBuilding", `B${index + 1}`, {
        content: `不是A${index + 1}，是B${index + 1}`,
        correction: true,
      });
      assert.strictEqual(after.memory.supersedes, before.memory.memoryId);
      const active = service.listMemoryItems({ principal: owner }).items;
      assert.strictEqual(active.length, 1);
      assert.strictEqual(active[0].normalizedValue, `B${index + 1}`);
      const historical = service.listMemoryItems({
        principal: owner,
        includeInactive: true,
        pageSize: 10,
      }).items;
      assert.strictEqual(
        historical.find((item) => item.memoryId === before.memory.memoryId).status,
        "superseded",
      );
      count += 1;
    }

    // 26-35: hybrid retrieval selects the semantically related active item.
    for (let index = 0; index < 10; index += 1) {
      const service = createService();
      const owner = principal(`semantic-${index}`);
      write(service, owner, "preferredBuilding", `C${index + 1}`);
      write(service, owner, "answerDetailLevel", index % 2 ? "detailed" : "concise", {
        kind: "interaction_preference",
        content: index % 2 ? "回答需要详细解释" : "回答保持简洁",
      });
      const buildingQuery = index % 2 === 0;
      const result = service.retrieveMemories({
        principal: owner,
        query: buildingQuery ? `去C${index + 1}楼找自习室` : "请按我的回答详细程度偏好回复",
        goal: buildingQuery ? "find_empty_room" : "project_qa",
        limit: 1,
      });
      assert.strictEqual(result.items[0].key, buildingQuery ? "preferredBuilding" : "answerDetailLevel");
      assert.ok(result.items[0].scoreBreakdown.vector >= 0);
      count += 1;
    }

    // 36-43: term/release changes expire schedule context but keep stable identity.
    for (let index = 0; index < 8; index += 1) {
      const service = createService();
      const owner = principal(`version-${index}`);
      write(service, owner, "preferredName", `同学${index + 1}`, {
        kind: "identity_alias",
      });
      const schedule = write(service, owner, "preferredClassName", `25测试${index + 1}班`, {
        kind: "task_constraint",
        scope: "release",
        termId: "2025-2026-2",
        releaseVersion: "rel-old",
      });
      service.invalidateContext({
        principal: owner,
        termId: "2026-2027-1",
        releaseVersion: "rel-new",
      });
      const active = service.listMemoryItems({ principal: owner }).items;
      assert.ok(active.some((item) => item.key === "preferredName"));
      assert.ok(!active.some((item) => item.memoryId === schedule.memory.memoryId));
      count += 1;
    }

    // 44-52: local/session modes never claim cloud writes; forbidden categories fail closed.
    for (let index = 0; index < 3; index += 1) {
      const service = createService();
      const owner = principal(`local-${index}`);
      const result = service.upsertMemory({
        principal: owner,
        memoryMode: "local_only",
        explicit: true,
        entry: {
          kind: "stable_preference",
          key: "campus",
          content: "常用仙溪校区",
          normalizedValue: "仙溪校区",
          provenance: { type: "user_explicit" },
          confidence: 1,
          scope: "user",
        },
      });
      assert.strictEqual(result.persisted, false);
      assert.strictEqual(service.listMemoryItems({ principal: owner }).items.length, 0);
      count += 1;
    }
    for (let index = 0; index < 3; index += 1) {
      const service = createService();
      const owner = principal(`session-${index}`);
      const result = service.upsertMemory({
        principal: owner,
        memoryMode: "session_state",
        explicit: true,
        entry: {
          kind: "stable_preference",
          key: "campus",
          content: "常用江湾校区",
          normalizedValue: "江湾校区",
          provenance: { type: "user_explicit" },
          confidence: 1,
          scope: "user",
        },
      });
      assert.strictEqual(result.persisted, false);
      count += 1;
    }
    ["schedule_snapshot", "weather", "raw_tool_output"].forEach((kind, index) => {
      const service = createService();
      assert.throws(() => service.upsertMemory({
        principal: principal(`forbidden-${index}`),
        memoryMode: "cloud_sync",
        explicit: true,
        entry: {
          kind,
          key: kind,
          content: "禁止长期保存",
          normalizedValue: { raw: true },
          provenance: { type: "tool_result" },
          confidence: 1,
          scope: "user",
        },
      }), (error) => error && error.code === "MEMORY_KIND_FORBIDDEN");
      count += 1;
    });

    // 53-60: ellipsis/anaphora keeps the confirmed target through one assembled snapshot.
    const followUps = ["那周三呢", "下午呢", "还是明天", "刚才那个班", "换成第17周", "它在哪", "继续", "就这个"];
    for (let index = 0; index < followUps.length; index += 1) {
      const context = await assembler.assemble({
        currentMessage: followUps[index],
        recentMessages: [
          { role: "user", content: "查25动物医学6班课表" },
          { role: "assistant", content: "已找到权威课表结果" },
        ],
        rollingSummary: "已确认目标班级=25动物医学6班",
        workingState: {
          activeGoal: "schedule_lookup",
          className: "25动物医学6班",
          currentScheduleTarget: { type: "class", detailId: "class-25-vet-6", name: "25动物医学6班" },
        },
      });
      assert.strictEqual(context.workingState.scheduleTarget.name, "25动物医学6班");
      assert.ok(context.rollingSummary.includes("25动物医学6班"));
      assert.strictEqual(context.views.decision.contextId, context.views.tool.contextId);
      count += 1;
    }

    assert.strictEqual(count, 60);
    console.log(`test-agent-memory-scenarios-60: PASS (${count} scenarios)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("test-agent-memory-scenarios-60: FAIL");
  console.error(error && error.stack || error);
  process.exit(1);
});
