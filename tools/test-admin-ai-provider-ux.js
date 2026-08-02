const assert = require("assert");
const fs = require("fs");
const path = require("path");

const file = path.resolve(__dirname, "../server/src/routes/adminPages.js");
const text = fs.readFileSync(file, "utf8");

[
  "正式版 / 公开发布",
  "体验版 / 开发调试",
  "公开发布 =",
  "体验/开发 =",
  "启用正式版本地规则",
  "启用增强理解能力",
  "保存并立即生效",
  "保存后运行真实测试",
  "高级诊断",
  "resolvedProvider",
  "latencyMs",
  "fallback",
  "toolCalls",
  "answerSnippet",
  "provider-mode-grid",
  "mirrorEnvironments",
  "saveAiExperienceDisabled",
  "isExperienceProvider",
  "provider-static-landing + .ai-provider-grid",
].forEach((needle) => {
  assert(text.includes(needle), `admin ai provider UX missing: ${needle}`);
});

const dynamicIndex = text.lastIndexOf("function renderAiProviderConfig()");
assert(dynamicIndex > 0, "renderAiProviderConfig override missing");
const afterDynamic = text.slice(dynamicIndex);
assert(afterDynamic.includes("provider-mode-grid"), "dynamic render must use two mode cards");
assert(afterDynamic.includes("aiExperienceEnabled"), "dynamic render must include experience switch");
assert(afterDynamic.includes("formatAiProviderVerifyResult"), "dynamic diagnostics formatter missing");
assert(afterDynamic.includes("buildAiProviderVerifyPayload"), "provider verification should bind to the selected environment");
assert(afterDynamic.includes("environment: environment"), "provider verification payload should include environment");
assert(afterDynamic.includes('environment === "dev" ? "develop" : "trial"'), "dev verification should use the develop envVersion");
assert(afterDynamic.includes("data-ai-experience-env"), "trial/dev should be directly switchable in the provider console");
assert(afterDynamic.includes('mirrorEnvironments: []'), "saving one experience environment must not overwrite the other profile");
assert(afterDynamic.includes("调用日志（持久化 · 已脱敏）"), "provider log must identify its durable source truthfully");
assert(afterDynamic.includes("2s 实时刷新"), "provider log should advertise the actual near-real-time cadence");
assert(text.includes("visibilitychange"), "provider log polling must pause while the page is hidden");
assert(text.includes("data.source"), "provider log should expose the backend-reported data source");
assert(text.includes("aiCallLogPending"), "provider log polling must not overlap slow requests");
assert(text.includes("item.environment"), "provider log must show the runtime environment");
assert(text.includes("item.runId") && text.includes("item.requestId"),
  "provider events must be correlatable to durable Run/request ids");
assert(!afterDynamic.includes("调用日志（进程内"), "the UI must not claim durable events are process-local");

console.log("test-admin-ai-provider-ux passed");
