#!/usr/bin/env node
/**
 * public mode: zero external generative provider calls.
 */
const providerChain = require("../server/src/services/ai/providerChainService");
const agentRunState = require("../server/src/services/ai/agentRunState");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log("PASS " + name); }
  else { fail += 1; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

const publicChain = providerChain.getProviderChain("public", {});
check("public chain only mock", publicChain.length === 1 && publicChain[0] === "mock", JSON.stringify(publicChain));

const trialChain = providerChain.getProviderChain("trial", {});
check("trial chain starts with coze or configured", trialChain[0] === "coze" || trialChain.includes("coze"), JSON.stringify(trialChain));
check("trial ends with mock", trialChain[trialChain.length - 1] === "mock");
check("trial includes cloudbase or deepseek fallback", trialChain.includes("cloudbase-openai") || trialChain.includes("deepseek"));

// entity lock stability
const state = agentRunState.createAgentRunState({ lockedEntityType: "class" });
agentRunState.lockEntityType(state, "teacher");
check("lockEntityType refuses rewrite class→teacher", state.lockedEntityType === "class");

const before = agentRunState.beforeToolCall("get_schedule_detail", { type: "teacher", id: "x" }, state);
check("get_schedule_detail forced class", before.ok && before.args.type === "class");

// convertToModelContext strips cards
const modelCtx = agentRunState.convertToModelContext({
  messages: [{ role: "user", content: "打开课表" }],
  cards: [{ type: "x" }],
  conversationSummary: "摘要",
}, [{ name: "search_school_index", status: "success", summary: "ok", result: { secret: "no" } }]);
check("model context has messages", Array.isArray(modelCtx.messages));
check("model context no cards field", modelCtx.cards === undefined);

// bounded loop
const limited = agentRunState.createAgentRunState({ maxTurns: 2 });
limited.turn = 2;
check("canContinue false at max turns", agentRunState.canContinue(limited) === false);

console.log("--- pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
