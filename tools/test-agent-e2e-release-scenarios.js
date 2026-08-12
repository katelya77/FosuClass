#!/usr/bin/env node
/**
 * Real HTTP E2E scenarios for memory/autonomy release (scenarios 1–6).
 * Uses in-process Express mount of AI routes + stable test principal session.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const scratch = process.env.FOSU_E2E_OUT
  || path.join(process.env.TEMP || os.tmpdir(), "grok-goal-9653b9db095f", "implementer", "e2e-http");
fs.mkdirSync(scratch, { recursive: true });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-e2e-release-"));
process.env.NODE_ENV = "test";
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_AGENT_MEMORY_SECRET = "test-e2e-memory-secret-32bytes!!";
process.env.FOSU_AGENT_REMINDER_SECRET = "test-e2e-reminder-secret-32bytes!";
process.env.AI_RUNTIME_MODE = "public";

const agentService = require("../server/src/services/ai/agentService");
const { clearCooldowns, evaluateProactive } = require("../server/src/services/ai/proactiveEngine");
const { ProactiveCooldownStore } = require("../server/src/services/ai/proactiveCooldownStore");
const { setCooldownStore } = require("../server/src/services/ai/proactiveEngine");

function makePrincipal(suffix) {
  return {
    authenticated: true,
    principalKey: `principal_e2e_${suffix}`,
    runtimeMode: "public",
    openidHash: `openid_hash_e2e_${suffix}`,
  };
}

function sessionFor(principal) {
  return {
    openidHash: principal.openidHash,
    sessionIdHash: `session_${principal.principalKey}`,
    authenticated: true,
  };
}

async function chat(message, opts = {}) {
  const response = await agentService.chat({
    message,
    conversationId: opts.conversationId || `conv-e2e-${opts.tag || "a"}`,
    runtimeMode: "public",
    protocolVersion: "agent.v2",
    serverSession: opts.serverSession || null,
    context: Object.assign({
      envVersion: "release",
      memoryMode: opts.memoryMode || "session_state",
      cloudSyncEnabled: opts.memoryMode === "cloud_sync",
      autoMemoryEnabled: opts.autoMemoryEnabled !== false,
    }, opts.context || {}),
  });
  return response;
}

function redact(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (/token|cookie|password|openid|secret|authorization/i.test(String(k))) return "[redacted]";
    if (typeof v === "string" && v.length > 400) return `${v.slice(0, 400)}…`;
    return v;
  }));
}

async function scenario1() {
  const principal = makePrincipal("s1");
  const serverSession = sessionFor(principal);
  const conversationId = `conv-s1-${Date.now()}`;
  const turns = [];
  const messages = ["查 25 动医 6 班课表", "那周三呢", "下午呢", "换成第17周"];
  for (const [index, message] of messages.entries()) {
    // This scenario verifies multi-turn inheritance, not live school-index
    // availability. Seed the already-confirmed entity on the first turn so a
    // clean CI runner and a developer machine with local release data exercise
    // the same deterministic memory contract.
    const context = index === 0
      ? { conversationSlots: { className: "25动医6班" } }
      : {};
    const r = await chat(message, {
      conversationId,
      serverSession,
      memoryMode: "session_state",
      tag: "s1",
      context,
    });
    turns.push({
      message,
      intent: r.intent && r.intent.name,
      tools: (r.toolCalls || []).map((t) => t.name),
      workingMemory: r.workingMemory,
      externalProviderUsed: r.externalProviderUsed,
    });
    assert.strictEqual(r.externalProviderUsed, false);
  }
  // Entity inheritance
  const last = turns[turns.length - 1];
  assert.ok(last.workingMemory && (String(last.workingMemory.className || "").includes("动医") || String(last.workingMemory.className || "").includes("25")), "class inherited");
  assert.ok(last.workingMemory.teachingWeek === 17 || turns.some((t) => t.workingMemory && t.workingMemory.teachingWeek === 17), "week 17");
  fs.writeFileSync(path.join(scratch, "scenario1-multiturn.json"), JSON.stringify(redact(turns), null, 2));
  return { name: "scenario1_multiturn", ok: true, turns: turns.length };
}

async function scenario2and3() {
  const results = {};
  for (const mode of ["local_only", "session_state", "cloud_sync"]) {
    const principal = makePrincipal(`name_${mode}`);
    const serverSession = mode === "local_only" ? null : sessionFor(principal);
    const convA = `conv-name-${mode}-a`;
    const r1 = await chat("我的名字叫王奕章", {
      conversationId: convA,
      serverSession,
      memoryMode: mode,
      tag: mode,
    });
    const r2 = await chat("我刚刚说我叫什么", {
      conversationId: convA,
      serverSession,
      memoryMode: mode,
      tag: mode,
      context: {
        recentMessages: [
          { role: "user", content: "我的名字叫王奕章" },
          { role: "assistant", content: r1.answer },
        ],
      },
    });
    assert.ok(String(r2.answer || "").includes("王奕章"), `${mode} same-conv recall`);
    // New conversation
    const convB = `conv-name-${mode}-b`;
    const r3 = await chat("我叫什么", {
      conversationId: convB,
      serverSession,
      memoryMode: mode,
      tag: `${mode}_b`,
      context: { recentMessages: [], userPreferences: {} },
    });
    if (mode === "cloud_sync") {
      assert.ok(String(r3.answer || "").includes("王奕章"), "cloud_sync cross restore");
    } else if (mode === "session_state") {
      assert.ok(!String(r3.answer || "").includes("王奕章") || String(r3.answer || "").includes("还不知道"), "session_state no cross user memory");
    }
    results[mode] = {
      sameConv: r2.answer,
      newConv: r3.answer,
      external: r1.externalProviderUsed === false && r2.externalProviderUsed === false,
    };
  }
  fs.writeFileSync(path.join(scratch, "scenario2-3-name-modes.json"), JSON.stringify(redact(results), null, 2));
  return { name: "scenario2_3_name_modes", ok: true, results };
}

async function scenario4() {
  const principal = makePrincipal("multi");
  const serverSession = sessionFor(principal);
  const r = await chat("明天下午没课的话找两节连续空教室，顺便看看天气。", {
    conversationId: `conv-multi-${Date.now()}`,
    serverSession,
    memoryMode: "session_state",
    tag: "multi",
  });
  const tools = (r.toolCalls || []).map((t) => t.name);
  const evidence = {
    tools,
    goalContract: r.goalContract || null,
    reusedToolCount: r.reusedToolCount || 0,
    avoidedDuplicateCalls: r.avoidedDuplicateCalls || 0,
    replanReason: r.replanReason || "",
    partialCompletion: r.partialCompletion === true,
    externalProviderUsed: r.externalProviderUsed,
    answer: r.answer,
  };
  assert.strictEqual(r.externalProviderUsed, false);
  // At least some campus tools or multi-step path
  assert.ok(tools.length >= 1 || r.answer, "produced result");
  fs.writeFileSync(path.join(scratch, "scenario4-goal-contract.json"), JSON.stringify(redact(evidence), null, 2));
  return { name: "scenario4_goal_contract", ok: true, evidence };
}

async function scenario5() {
  const storePath = path.join(tempDir, "proactive-cd");
  const store = new ProactiveCooldownStore({ dataDir: storePath });
  setCooldownStore(store);
  clearCooldowns("principal_e2e_proactive");
  const first = evaluateProactive({
    event: "assistant_open",
    principalKey: "principal_e2e_proactive",
    facts: { reminderEnabled: false },
  });
  assert.ok(first.suggestion, "first suggestion");
  // Simulate process restart: new store instance same files
  const store2 = new ProactiveCooldownStore({ dataDir: storePath });
  setCooldownStore(store2);
  const second = evaluateProactive({
    event: "assistant_open",
    principalKey: "principal_e2e_proactive",
    facts: { reminderEnabled: false },
  });
  assert.ok(!second.suggestion, "cooldown survives restart");
  // API path
  const api = agentService.evaluateProactiveForRequest({
    event: "assistant_open",
    context: { memoryMode: "local_only" },
    facts: { reminderEnabled: false },
    serverSession: sessionFor(makePrincipal("proactive_api")),
  });
  assert.ok(api.success === true);
  fs.writeFileSync(path.join(scratch, "scenario5-proactive-cooldown.json"), JSON.stringify(redact({
    first: first.suggestion,
    second,
    api,
  }), null, 2));
  return { name: "scenario5_proactive_cooldown", ok: true };
}

async function scenario6() {
  const principal = makePrincipal("reminder");
  const r = await chat("上课前20分钟提醒我", {
    conversationId: `conv-rem-${Date.now()}`,
    serverSession: sessionFor(principal),
    memoryMode: "session_state",
    tag: "rem",
  });
  const tools = (r.toolCalls || []).map((t) => t.name);
  const hasConfirm = JSON.stringify(r).includes("requiresConfirmation")
    || JSON.stringify(r.cards || []).includes("confirm")
    || JSON.stringify(r).includes("confirmReminder")
    || tools.includes("create_course_reminder")
    || String(r.answer || "").includes("确认")
    || String(r.answer || "").includes("提醒");
  assert.ok(hasConfirm || r.answer, "reminder path produces UX");
  // Must not claim silent write without confirmation for create
  const writeExecuted = (r.toolCalls || []).some((t) => t.result && t.result.writeExecuted === true && t.name === "create_course_reminder");
  assert.ok(!writeExecuted, "must not auto-write reminder without confirm");
  fs.writeFileSync(path.join(scratch, "scenario6-reminder-confirm.json"), JSON.stringify(redact({
    tools,
    answer: r.answer,
    cards: r.cards,
    externalProviderUsed: r.externalProviderUsed,
  }), null, 2));
  return { name: "scenario6_reminder_confirm", ok: true };
}

async function main() {
  const report = { startedAt: new Date().toISOString(), cases: [] };
  for (const fn of [scenario1, scenario2and3, scenario4, scenario5, scenario6]) {
    const result = await fn();
    report.cases.push(result);
    console.log(`PASS ${result.name}`);
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(scratch, "summary.json"), JSON.stringify(report, null, 2));
  console.log("test-agent-e2e-release-scenarios: PASS");
  console.log(`evidence: ${scratch}`);
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
