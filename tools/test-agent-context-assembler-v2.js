#!/usr/bin/env node
const assert = require("assert");
const {
  SECTION_ORDER,
  createContextAssembler,
} = require("../packages/agent-runtime");
const {
  MEMORY_PROJECTION_POLICY_VERSION,
} = require("../packages/agent-runtime/src/contextAssembler");

const NOW = 1785398400000;

function baseInput(overrides = {}) {
  const recentMessages = Array.from({ length: 15 }, (_, index) => ({
    id: `turn-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: index === 2 ? "password=do-not-keep" : `safe-message-${index}`,
  }));
  return {
    currentMessage: "Find an empty room tomorrow afternoon",
      runtimeMode: "trial",
      configVersion: "config-v7",
    manifestSummary: {
      version: "manifest-9",
      skillIds: ["campus.schedule.lookup"],
      toolIds: ["query_empty_rooms"],
    },
    recentMessages,
    rollingSummary: "The user confirmed that concise answers are preferred.",
    workingState: {
      activeGoal: "find_empty_room",
      campus: "Xianxi campus",
      personalScheduleAvailable: true,
      currentScheduleTarget: {
        type: "class",
        detailId: "class-1",
        name: "Class 6",
        term: "2025-2026-2",
      },
      rawToolResult: { courses: [{ password: "never-copy" }] },
    },
    pendingClarification: {
      intentName: "search_empty_rooms",
      missing: "section",
      expiresAt: NOW + 60_000,
    },
    pendingAction: {
      command: "createCourseReminder",
      status: "awaiting_receipt",
      expiresAt: NOW + 60_000,
      target: { detailId: "reminder-1", name: "Course reminder" },
    },
    memoryItems: [
      {
        memoryId: "memory-active",
        key: "campus",
        content: "Usually uses Xianxi campus",
        status: "active",
        confidence: 0.98,
        provenance: { type: "user_explicit", turnId: "turn-fixture-1" },
        scope: "user",
        expiresAt: new Date(NOW + 86400000).toISOString(),
        score: 0.9,
      },
      {
        memoryId: "memory-old",
        key: "campus",
        content: "Old campus preference",
        status: "superseded",
        confidence: 1,
        provenance: { type: "user_explicit" },
        scope: "user",
        score: 1,
      },
    ],
    episodicMemories: [
      {
        episodeId: "episode-success",
        goal: "find_empty_room",
        outcomeSummary: "Found two continuous free periods",
        status: "success",
        expiresAt: new Date(NOW + 86400000).toISOString(),
        score: 0.8,
      },
      {
        episodeId: "episode-failed",
        goal: "weather",
        outcomeSummary: "A failed weather lookup",
        status: "failed",
        score: 1,
      },
    ],
    ragCitations: [{
      citationId: "citation-1",
      title: "Public guide",
      snippet: "Use the authoritative campus tool for timetable facts.",
    }],
    runtimeContext: {
      currentPage: "pages/ai-assistant/index",
      todayDate: "2026-07-30",
      currentTeachingWeek: 2,
      term: "2025-2026-2",
      releaseVersion: "release-2",
      currentScheduleSummary: {
        courses: [{ courseName: "full schedule must not be copied" }],
      },
    },
    ...overrides,
  };
}

async function testSafeCanonicalSnapshotAndLeastPrivilegeViews() {
  const assembler = createContextAssembler({ clock: { now: () => NOW } });
  const assembled = await assembler.assemble(baseInput());

  assert.strictEqual(assembled.schemaVersion, "agent-context.v2");
  assert.strictEqual(assembled.owner, "@xiaofu-agent/agent-runtime");
  assert.strictEqual(assembled.config.configVersion, "config-v7");
  assert.deepStrictEqual(assembled.sectionOrder, SECTION_ORDER);
  assert.deepStrictEqual(assembled.manifest, {
    version: "manifest-9",
    allowedSkillIds: ["campus.schedule.lookup"],
    allowedToolIds: ["query_empty_rooms"],
  });
  assert.strictEqual(assembled.safety.factsRequireAuthoritativeTools, true);
  assert.ok(assembled.recentMessages.length >= 8 && assembled.recentMessages.length <= 12);
  assert.strictEqual(assembled.workingState.currentPage, "pages/ai-assistant/index");
  assert.strictEqual(assembled.workingState.scheduleTarget.name, "Class 6");
  assert.strictEqual(assembled.workingState.personalScheduleAvailable, true);
  assert.strictEqual(typeof assembled.workingState.personalScheduleAvailable, "boolean");
  assert.strictEqual(assembled.pending.clarification.missing, "section");
  assert.strictEqual(assembled.pending.clarificationExpired, false);
  assert.strictEqual(assembled.pending.actionExpired, false);
  assert.deepStrictEqual(assembled.selectedMemoryIds, ["memory-active"]);
  assert.match(assembled.selectionFingerprint, /^[0-9a-f]{24}$/);
  assert.strictEqual(assembled.trace.selectionFingerprint, assembled.selectionFingerprint);
  assert.deepStrictEqual(assembled.selectedEpisodeIds, ["episode-success"]);

  const serialized = JSON.stringify(assembled);
  ["do-not-keep", "never-copy", "full schedule must not be copied", "rawToolResult"].forEach((value) => {
    assert.ok(!serialized.includes(value), `must redact or drop ${value}`);
  });

  const decision = assembled.views.decision;
  assert.strictEqual(decision.memoryPolicyVersion, MEMORY_PROJECTION_POLICY_VERSION);
  assert.deepStrictEqual(decision.safety, assembled.safety);
  assert.deepStrictEqual(decision.manifest, assembled.manifest);
  assert.deepStrictEqual(decision.memories, assembled.memories);
  assert.deepStrictEqual(decision.episodes, assembled.episodes);
  assert.deepStrictEqual(decision.rag, assembled.rag);
  assert.deepStrictEqual(decision.recentMessages, assembled.recentMessages);

  const response = assembled.views.response;
  assert.deepStrictEqual(response.safety, assembled.safety);
  assert.deepStrictEqual(response.manifest, assembled.manifest);
  assert.deepStrictEqual(response.rag, assembled.rag);
  ["pending", "recentMessages", "rollingSummary", "memories", "episodes"].forEach((key) => {
    assert.ok(!Object.prototype.hasOwnProperty.call(response, key), `response view must omit ${key}`);
  });

  const tool = assembled.views.tool;
  assert.deepStrictEqual(tool.safety, assembled.safety);
  assert.deepStrictEqual(tool.manifest, assembled.manifest);
  assert.deepStrictEqual(tool.currentTurn, { runtimeMode: "trial" });
  ["pending", "recentMessages", "rollingSummary", "memories", "episodes", "rag"].forEach((key) => {
    assert.ok(!Object.prototype.hasOwnProperty.call(tool, key), `tool view must omit ${key}`);
  });
  assert.ok(!JSON.stringify(tool).includes("Find an empty room"), "tool view must not receive user history/message text");

  ["decision", "tool", "verification", "response"].forEach((name) => {
    assert.strictEqual(assembled.views[name].contextId, assembled.contextId);
  });
  assert.ok(Object.isFrozen(assembled) && Object.isFrozen(assembled.views.tool));
}

async function testPendingItemsExpireAgainstAssemblerClock() {
  const assembler = createContextAssembler({ clock: { now: () => NOW } });
  const assembled = await assembler.assemble(baseInput({
    pendingClarification: {
      intentName: "expired_clarification",
      expiresAt: new Date(NOW - 1).toISOString(),
    },
    pendingAction: {
      command: "expired_action",
      expiresAt: new Date(NOW).toISOString(),
    },
  }));
  assert.deepStrictEqual(assembled.pending, {
    clarification: null,
    action: null,
    clarificationExpired: true,
    actionExpired: true,
  });
}

async function testScheduleAvailabilityNeverCopiesScheduleData() {
  const assembler = createContextAssembler({ clock: { now: () => NOW } });
  const assembled = await assembler.assemble(baseInput({
    workingState: { personalScheduleAvailable: "yes" },
    runtimeContext: {
      personalScheduleAvailable: false,
      currentScheduleSummary: { courses: [{ courseName: "secret schedule row" }] },
    },
  }));
  assert.strictEqual(assembled.workingState.personalScheduleAvailable, false);
  assert.strictEqual(typeof assembled.workingState.personalScheduleAvailable, "boolean");
  assert.ok(!JSON.stringify(assembled).includes("secret schedule row"));
}

async function testHardBudgetAndCompressionMetadata() {
  const assembler = createContextAssembler({
    clock: { now: () => NOW },
    contextTokenBudget: 800,
  });
  const longText = "long context ".repeat(500);
  const assembled = await assembler.assemble(baseInput({
    currentMessage: longText,
    recentMessages: Array.from({ length: 12 }, (_, index) => ({
      id: `long-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: longText,
    })),
    rollingSummary: longText,
    memoryItems: Array.from({ length: 5 }, (_, index) => ({
      memoryId: `memory-${index}`,
      content: longText,
      status: "active",
      expiresAt: new Date(NOW + 86400000).toISOString(),
      score: 1 - index / 10,
    })),
    episodicMemories: Array.from({ length: 3 }, (_, index) => ({
      episodeId: `episode-${index}`,
      outcomeSummary: longText,
      status: "success",
      expiresAt: new Date(NOW + 86400000).toISOString(),
      score: 1 - index / 10,
    })),
    ragCitations: Array.from({ length: 4 }, (_, index) => ({
      citationId: `citation-${index}`,
      snippet: longText,
    })),
  }));

  assert.ok(assembled.contextTokenEstimate <= 800, `${assembled.contextTokenEstimate} exceeds hard budget`);
  assert.strictEqual(assembled.compressionUsed, true);
  assert.ok(assembled.truncatedSections.length > 0);
  assert.deepStrictEqual(assembled.trace.truncatedSections, assembled.truncatedSections);
  assert.strictEqual(assembled.trace.compressionUsed, true);
  assert.strictEqual(assembled.trace.contextTokenEstimate, assembled.contextTokenEstimate);
}

async function testContextIdentityAndTraceCoverEverySectionWithoutLeakingContent() {
  const input = baseInput();
  const assembler = createContextAssembler({ clock: { now: () => NOW }, contextTokenBudget: 2400 });
  const sameA = await assembler.assemble(input);
  const sameB = await assembler.assemble(input);
  const changedContent = await assembler.assemble(baseInput({
    ragCitations: [{ citationId: "citation-1", title: "Public guide", snippet: "Changed snippet only" }],
  }));
  const changedConfig = await createContextAssembler({
    clock: { now: () => NOW },
    contextTokenBudget: 2600,
  }).assemble(input);

  assert.strictEqual(sameA.contextId, sameB.contextId);
  assert.notStrictEqual(sameA.contextId, changedContent.contextId, "content-only changes must change contextId");
  assert.notStrictEqual(sameA.contextId, changedConfig.contextId, "assembler config changes must change contextId");

  assert.deepStrictEqual(Object.keys(sameA.trace.sectionFingerprints).sort(), [...SECTION_ORDER, "manifest"].sort());
  Object.values(sameA.trace.sectionFingerprints).forEach((fingerprint) => {
    assert.match(fingerprint, /^[0-9a-f]{16}$/);
  });
  assert.deepStrictEqual(sameA.trace.counts, {
    recentMessages: sameA.recentMessages.length,
    memories: sameA.memories.length,
    episodes: sameA.episodes.length,
    rag: sameA.rag.length,
  });
  const traceJson = JSON.stringify(sameA.trace);
  [
    "Find an empty room",
    "Usually uses Xianxi campus",
    "Found two continuous free periods",
    "authoritative campus tool",
  ].forEach((content) => assert.ok(!traceJson.includes(content), `trace leaked ${content}`));
}

async function testMemoryProjectionPolicyAuditAndExclusionReasons() {
  const assembler = createContextAssembler({ clock: { now: () => NOW } });
  const assembled = await assembler.assemble(baseInput({
    memoryItems: [
      {
        memoryId: "memory-valid",
        key: "preferredBuilding",
        content: "Prefers building B8 for self-study",
        status: "active",
        confidence: 0.9,
        provenance: { type: "user_explicit" },
        scope: "user",
        expiresAt: new Date(NOW + 86400000).toISOString(),
        score: 0.9,
      },
      {
        memoryId: "memory-expired",
        key: "campus",
        content: "Expired campus hint",
        status: "active",
        confidence: 0.9,
        provenance: { type: "user_explicit" },
        scope: "user",
        expiresAt: new Date(NOW - 1000).toISOString(),
        score: 0.8,
      },
      {
        memoryId: "memory-sensitive",
        key: "campus",
        content: "contact phone 13800138000",
        status: "active",
        confidence: 0.9,
        provenance: { type: "user_explicit" },
        scope: "user",
        expiresAt: new Date(NOW + 86400000).toISOString(),
        score: 0.7,
      },
      {
        memoryId: "memory-low-confidence",
        key: "campus",
        content: "Weakly inferred campus",
        status: "active",
        confidence: 0.2,
        provenance: { type: "auto_extract" },
        scope: "user",
        expiresAt: new Date(NOW + 86400000).toISOString(),
        score: 0.6,
      },
      {
        memoryId: "memory-no-provenance",
        key: "campus",
        content: "Provenance-free hint",
        status: "active",
        confidence: 0.9,
        scope: "user",
        expiresAt: new Date(NOW + 86400000).toISOString(),
        score: 0.5,
      },
      {
        memoryId: "memory-scope-mismatch",
        key: "preferredClassName",
        content: "Bound to another release",
        status: "active",
        confidence: 0.9,
        provenance: { type: "action_receipt" },
        scope: "release",
        termId: "1999-2000-1",
        releaseVersion: "release-0",
        expiresAt: new Date(NOW + 86400000).toISOString(),
        score: 0.4,
      },
      {
        memoryId: "memory-no-expiry",
        key: "campus",
        content: "Expiry-free hint must fail closed",
        status: "active",
        confidence: 0.9,
        provenance: { type: "user_explicit" },
        scope: "user",
        score: 0.3,
      },
    ],
  }));

  assert.deepStrictEqual(assembled.selectedMemoryIds, ["memory-valid"]);
  assert.deepStrictEqual(assembled.trace.memoryProjection, {
    policyVersion: MEMORY_PROJECTION_POLICY_VERSION,
    selectedMemories: 1,
    selectedEpisodes: 1,
    excluded: {
      expired: 2,
      sensitivity: 1,
      confidence: 1,
      provenance: 1,
      scope: 1,
      schema: 1,
    },
  });
  const traceJson = JSON.stringify(assembled.trace);
  ["13800138000", "Expired campus hint", "Weakly inferred campus", "Provenance-free hint", "Bound to another release", "Expiry-free hint"]
    .forEach((content) => assert.ok(!traceJson.includes(content), `trace leaked excluded memory: ${content}`));
  assert.ok(Object.isFrozen(assembled.memoryProjection));
}

async function main() {
  await testSafeCanonicalSnapshotAndLeastPrivilegeViews();
  await testPendingItemsExpireAgainstAssemblerClock();
  await testScheduleAvailabilityNeverCopiesScheduleData();
  await testHardBudgetAndCompressionMetadata();
  await testContextIdentityAndTraceCoverEverySectionWithoutLeakingContent();
  await testMemoryProjectionPolicyAuditAndExclusionReasons();
  console.log("test-agent-context-assembler-v2: PASS");
}

main().catch((error) => {
  console.error("test-agent-context-assembler-v2: FAIL");
  console.error(error && error.stack || error);
  process.exit(1);
});
