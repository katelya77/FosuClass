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

console.log("test-admin-ai-provider-ux passed");
