"use strict";
// R50.0 Prompt 编译器：将 agents/shared/*.md 策略与 agents/<domain>.md 组合为
// 可直接粘贴到 ADP 控制台 / ChatGPT 的最终 Prompt（agents/compiled/*.md）。
//
// 运行（Windows）：
//   cd competition\adp-kit\r50; node build-agent-prompts.js [--check]
//
// 组合规则：
//   1. 每个域 Prompt = 固定头部声明 + 按序插入全部 shared 策略全文 + 域 Prompt 全文。
//   2. 生成的 compiled/*.md 是唯一可粘贴产物；域 Prompt 文件保持「可读真源」。
//   3. 确定性：同输入重复生成字节一致（无时间戳 / 随机量）。
//   4. --check 模式：漂移检测（compiled 与按当前源重算结果不一致 → exit 1）。

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SHARED_DIR = path.join(ROOT, "agents", "shared");
const AGENTS_DIR = path.join(ROOT, "agents");
const COMPILED_DIR = path.join(ROOT, "agents", "compiled");

const SHARED_ORDER = [
  "core-safety.md",
  "intent-policy.md",
  "temporal-policy.md",
  "entity-policy.md",
  "context-policy.md",
  "ranking-policy.md",
  "output-policy.md",
];

const DOMAINS = [
  "main-orchestrator.md",
  "schedule-space.md",
  "risk-planning.md",
  "campus-insight.md",
];

const HEADER =
  "# 小佛助手 Agent Prompt（R50.0 编译产物）\n" +
  "> 本文件由 `build-agent-prompts.js` 确定性生成（shared 策略 + 域 Prompt 组合）。\n" +
  "> 请勿手工编辑本文件；如需修改请在 `agents/shared/*.md` 与 `agents/<domain>.md` 编辑后重新编译。\n\n" +
  "<!-- COMPILED-BY: build-agent-prompts.js R50.0 -->\n";

function read(name) {
  return fs.readFileSync(path.join(ROOT, "agents", name), "utf8").trimEnd();
}

function compile(domainName) {
  const sharedSections = SHARED_ORDER.map((f) => read(path.join("shared", f)));
  const domain = read(domainName);
  const parts = [HEADER, "---\n\n## 引用的 Shared 策略（编译自动注入）\n"];
  sharedSections.forEach((s, i) => {
    parts.push(`<!-- shared:${SHARED_ORDER[i]} -->\n${s}`);
  });
  parts.push("---\n\n## 域 Prompt\n", domain);
  return parts.join("\n\n") + "\n";
}

function ensureDir() {
  fs.mkdirSync(COMPILED_DIR, { recursive: true });
}

function buildAll() {
  const outputs = {};
  for (const name of DOMAINS) {
    const compiledName = name.replace(/\.md$/, ".compiled.md");
    outputs[compiledName] = compile(name);
  }
  return outputs;
}

function writeAll(outputs) {
  ensureDir();
  for (const [file, content] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(COMPILED_DIR, file), content, "utf8");
  }
  console.log(`[compiled] ${Object.keys(outputs).length} prompts -> agents/compiled/`);
}

function checkAll(outputs) {
  ensureDir();
  let drift = [];
  for (const [file, content] of Object.entries(outputs)) {
    const target = path.join(COMPILED_DIR, file);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
      drift.push(file);
    }
  }
  if (drift.length) {
    console.error(`[drift] ${drift.length} compiled prompt(s) 与源不一致：${drift.join(", ")}`);
    console.error("      请运行 `node build-agent-prompts.js` 重新生成后提交。");
    process.exit(1);
  }
  console.log(`[pass] compiled prompts 与 shared/domain 源一致（${Object.keys(outputs).length} files）`);
}

if (process.argv.includes("--check")) {
  checkAll(buildAll());
} else {
  writeAll(buildAll());
}
