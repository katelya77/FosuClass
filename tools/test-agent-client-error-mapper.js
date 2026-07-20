#!/usr/bin/env node
const assert = require("assert");
const mapper = require("../miniprogram/services/agentClientErrorMapper");

assert.strictEqual(mapper.userMessage("CONVERSATION_NOT_FOUND").includes("会话"), true);
assert.strictEqual(mapper.userMessage({ code: "PROVIDER_TIMEOUT" }).includes("超时"), true);
assert.strictEqual(mapper.userMessage({ message: "Conversation not found" }).includes("会话"), true);
assert.strictEqual(mapper.userMessage({ message: "PATCH_FAILED", code: "PATCH_FAILED" }).includes("失败"), true);
assert.ok(!/Conversation not found/.test(mapper.userMessage("CONVERSATION_NOT_FOUND")));
assert.ok(!/PROVIDER_TIMEOUT/.test(mapper.userMessage("PROVIDER_TIMEOUT")));

console.log("test-agent-client-error-mapper passed");
