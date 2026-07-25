// 第八章：发布后检索冒烟 v2（对齐真实接口签名）
const kb = require("../server/src/services/ai/knowledgeBaseService");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

const queries = [
  { q: "今天有什么课", expect: "assistant-rule-today-schedule" },
  { q: "空教室", expect: "assistant-rule-empty-room" },
  { q: "怎么导入个人课表", expect: "assistant-rule-personal-import" },
  { q: "现在第几周", expect: "assistant-rule-teaching-week" },
];

for (const { q, expect } of queries) {
  const res = kb.searchKnowledge({ q, scope: "public" });
  const matches = res.ruleMatches || [];
  const found = matches.some((m) => m.id === expect);
  check(`public 检索「${q}」召回 ${expect}`, found, matches.map((m) => m.id).join(",") + " | version=" + res.version);
}

// matchLocalRule 直达匹配
const direct = kb.matchLocalRule({ q: "明天有什么课", scope: "public" });
check("matchLocalRule「明天有什么课」命中明日课表规则", direct.matched && direct.rule && direct.rule.id === "assistant-rule-tomorrow-schedule", (direct.rule && direct.rule.id) || "none");

// trial-dev-internal 不得出现在 public 范围
const leakRes = kb.searchKnowledge({ q: "Provider DeepSeek Coze 开发版", scope: "public" });
const leakItems = (leakRes.items || []).concat(leakRes.ruleMatches || []);
const leaked = leakItems.some((h) => (h.id || h.sourceId || "").includes("trial-dev-internal"));
check("内部说明条目不泄漏到 public scope", !leaked);

// trial scope 应可见内部说明
const trialRes = kb.searchKnowledge({ q: "Provider DeepSeek Coze 开发版", scope: "trial" });
const trialItems = (trialRes.items || []);
const trialVisible = trialItems.some((h) => (h.sourceId || "").includes("trial-dev-internal"));
check("trial scope 可见内部说明条目", trialVisible, trialItems.map((h) => h.sourceId).join(","));

// 发布 prompt 可见（签名为 (environment, query)）
const prompt = kb.getPublishedKnowledgePrompt("public", "今天有什么课");
const text = typeof prompt === "string" ? prompt : (prompt && prompt.prompt) || "";
check("getPublishedKnowledgePrompt(public) 非空且含今日课表", text.length > 0 && text.includes("今日课表"), "len=" + text.length);

console.log("---");
console.log("pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
