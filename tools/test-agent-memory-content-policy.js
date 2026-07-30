#!/usr/bin/env node
const assert = require("assert");
const { MemoryController } = require("../server/src/services/ai/memory/memoryController");
const { sanitizeDurableTurnText } = require("../server/src/services/ai/memory/threadMemory");

function main() {
  const persisted = [];
  const conversationMemory = {
    persistAfterSuccess(input) {
      persisted.push(input);
      return {
        mode: input.memoryMode,
        authenticated: true,
        persisted: true,
        synced: input.memoryMode === "cloud_sync",
        revision: persisted.length,
      };
    },
  };
  const userMemory = {
    commit() { return { persisted: false, keys: [], items: [] }; },
    appendEpisode() { return { persisted: false, reason: "test" }; },
  };
  const controller = new MemoryController({ conversationMemory, userMemory });
  const sensitiveScheduleAnswer = [
    "Monday 1-2: Anatomy, room B8-203, teacher Zhang",
    "Tuesday 3-4: English, room C7-101, teacher Li",
    "Wednesday 5-6: Physics, room D2-301, teacher Chen",
  ].join("\n");

  const result = controller.commit({
    principal: { authenticated: true, principalKey: "content-policy-user" },
    memoryMode: "cloud_sync",
    conversationId: "content-policy-conversation",
    message: "show my full schedule",
    answer: sensitiveScheduleAnswer,
    intentName: "get_week_schedule",
    toolCalls: [{ name: "get_week_courses", result: { success: true } }],
    observations: [{
      tool: "get_week_courses",
      status: "success",
      factCount: 3,
      summary: sensitiveScheduleAnswer,
    }],
    status: "completed",
    verified: true,
    runId: "run-content-policy",
    context: { term: "2026-2027-1", releaseVersion: "release-1" },
  });

  const stored = persisted[0];
  assert.strictEqual(stored.message, "show my full schedule");
  assert(!stored.answer.includes("B8-203"));
  assert(!JSON.stringify(stored.recentTurns).includes("C7-101"));
  assert(!JSON.stringify(stored.workingMemory).includes("D2-301"));
  assert(!String(stored.conversationSummary).includes("Anatomy"));
  assert(!String(result.workingMemory.lastRecommendation.summary).includes("B8-203"));
  assert(!String(result.workingMemory.lastObservations[0].summary).includes("B8-203"));

  const weather = sanitizeDurableTurnText("Tomorrow is 34C with 80% rain", {
    role: "assistant",
    toolNames: ["get_campus_weather"],
    intentName: "weather_lookup",
  });
  assert(!weather.includes("34C"));
  assert(weather.includes("未保留"));
  assert.strictEqual(weather, "[天气结果具有时效性，未保留]");

  const raw = sanitizeDurableTurnText('{"success":true,"data":{"secretFact":"raw"}}', {
    role: "assistant",
    toolNames: [],
    intentName: "general_assistant",
  });
  assert.strictEqual(raw, "[原始工具结果未保留]");

  const pastedSchedule = [
    "星期一 第1-2节 课程A 教室A101",
    "星期二 第3-4节 课程B 教室B202",
    "星期三 第5-6节 课程C 教室C303",
    "星期四 第7-8节 课程D 教室D404",
    "星期五 第9-10节 课程E 教室E505",
  ].join("\n");
  const sanitizedUser = sanitizeDurableTurnText(pastedSchedule, { role: "user" });
  assert(!sanitizedUser.includes("A101"));
  assert(sanitizedUser.includes("未保留"));
  assert.strictEqual(sanitizedUser, "[课表快照未保留，将由权威工具重新查询]");

  console.log("test-agent-memory-content-policy: PASS");
}

try {
  main();
} catch (error) {
  console.error("test-agent-memory-content-policy: FAIL");
  console.error(error && error.stack || error);
  process.exit(1);
}
