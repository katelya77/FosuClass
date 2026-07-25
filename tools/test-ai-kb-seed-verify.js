// 第八章：种子内部官方来源一致性核验（不 fetch 外网，自述型知识的官方源=项目权威文件）
const fs = require("fs");
const path = require("path");
const seed = require("./seed-assistant-local-rules").buildSeedEntries();
const kb = require("../server/src/services/ai/knowledgeBaseService");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

const manifest = require("../server/config/agent-capability-manifest.json");
const manifestTools = new Set(Object.keys(manifest.tools || {}));
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../miniprogram/app.json"), "utf8"));
const pages = new Set((appJson.pages || []).map((p) => "/" + p));
const subPages = new Set();
(appJson.subPackages || appJson.subpackages || []).forEach((sp) => (sp.pages || []).forEach((p) => subPages.add("/" + sp.root.replace(/\/$/, "") + "/" + p)));
const allPages = new Set([...pages, ...subPages]);

// 1. toolName 必须在 manifest.tools 注册（官方工具源）
const all = [...seed.rules, ...seed.docs];
const toolRefs = seed.rules.filter((r) => r.toolName);
const badTools = toolRefs.filter((r) => !manifestTools.has(r.toolName));
check("rule.toolName 全部在 manifest.tools 注册 (" + toolRefs.length + " 条)", badTools.length === 0, badTools.map((r) => r.id + ":" + r.toolName).join(","));

// 2. card/action 页面路径必须存在于 app.json
const badRoutes = [];
all.forEach((e) => {
  const urls = [];
  if (e.action && e.action.url) urls.push(e.action.url);
  ((e.card && e.card.actions) || []).forEach((a) => a.url && urls.push(a.url));
  urls.forEach((u) => {
    const page = u.split("?")[0];
    if (!allPages.has(page)) badRoutes.push(e.id + " -> " + page);
  });
});
check("card/action 页面路由全部存在于 app.json", badRoutes.length === 0, badRoutes.join(","));

// 3. body/reply 不得含硬编码外部事实（URL/电话/具体日期/学号样例）
const FACT_PATTERNS = [
  { name: "url", re: /https?:\/\// },
  { name: "phone", re: /0\d{2,3}-?\d{7,8}|1[3-9]\d{9}/ },
  { name: "date", re: /20\d{2}[年\-\/]\d{1,2}[月\-\/]\d{1,2}/ },
  { name: "studentId-sample", re: /\b20\d{8,}\b/ },
];
const factHits = [];
all.forEach((e) => {
  const text = [e.body, e.reply, e.title].filter(Boolean).join("\n");
  FACT_PATTERNS.forEach((p) => { if (p.re.test(text)) factHits.push(e.id + ":" + p.name); });
});
check("种子正文无硬编码外部事实（url/phone/date/id）", factHits.length === 0, factHits.join(","));

// 4. validateEntrySecurity 无 block 级风险
const risks = all.flatMap((e) => kb.validateEntrySecurity(e).risks.map((r) => ({ entryId: e.id, ...r })));
const blocking = risks.filter((r) => r.level === "block");
check("validateEntrySecurity 无 block 级风险", blocking.length === 0, blocking.map((r) => r.entryId + ":" + r.code).join(","));
console.log("warn-level risks: " + risks.filter((r) => r.level !== "block").length);

// 5. 来源元数据覆盖检查：每条种子需可追溯到官方源（内建 sources + 工具注册 + 路由核验结果）
check("seed.sources 含内部权威源引用", !!(seed.sources && seed.sources.toolRegistry && seed.sources.inventory));

console.log("---");
console.log("pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
