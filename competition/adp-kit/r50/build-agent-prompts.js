"use strict";
// R50.1 Prompt 编译器：将 agents/shared/*.md 策略与 agents/<domain>.md 组合为
// 可直接粘贴到 ADP 控制台 / ChatGPT 的最终 Prompt（agents/compiled/*.md）。
//
// 运行（Windows）：
//   cd competition\adp-kit\r50; node build-agent-prompts.js            # 重新编译全部
//   node build-agent-prompts.js --check                                # 漂移检测（exit 1 = 漂移）
//   node build-agent-prompts.js --print main|schedule|risk|insight     # 输出单个 compiled Prompt 到 stdout
//   node build-agent-prompts.js --export-final                         # 导出纯净 final Prompt 到 ../r50.1/prompts/
//   node build-agent-prompts.js --print-final main|schedule|risk|insight  # 输出单个 final Prompt 到 stdout
//
// 组合规则：
//   1. 每个域 Prompt = 固定头部声明 + 按序插入全部 shared 策略全文 + 域 Prompt 全文。
//   2. 生成的 compiled/*.md 是唯一可粘贴产物；域 Prompt 文件保持「可读真源」。
//   3. 确定性：同输入重复生成字节一致（无时间戳 / 随机量）。
//   4. --check 模式：漂移检测（compiled 与按当前源重算结果不一致 → exit 1）。
//   5. --print <domain>：输出编译产物到 stdout（不写盘）。
//   6. final 模式（--export-final / --print-final）：剥离编译器说明、`<!-- shared:... -->`
//      与 `<!-- COMPILED-BY -->` 标记，生成可直接 Ctrl+A 粘贴的纯净 Prompt（R50.1 Paste Pack）。

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SHARED_DIR = path.join(ROOT, "agents", "shared");
const AGENTS_DIR = path.join(ROOT, "agents");
const COMPILED_DIR = path.join(ROOT, "agents", "compiled");
const FINAL_DIR = path.join(ROOT, "..", "r50.1", "prompts");

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

const COMPILED_VERSION = "R50.1";

const HEADER =
  "# 校园智序 · 小序 Agent Prompt（R50.1 编译产物）\n" +
  "> 本文件由 `build-agent-prompts.js` 确定性生成（shared 策略 + 域 Prompt 组合）。\n" +
  "> 请勿手工编辑本文件；如需修改请在 `agents/shared/*.md` 与 `agents/<domain>.md` 编辑后重新编译。\n\n" +
  `<!-- COMPILED-BY: build-agent-prompts.js ${COMPILED_VERSION} -->\n`;

const FINAL_HEADER = "# 校园智序 · 小序 Agent Prompt（R50.1）\n\n" +
  "> 本 Prompt 为控制台直接粘贴版：Shared 基础策略 + 域 Prompt。\n";

const DOMAIN_ALIASES = {
  main: "main-orchestrator.md",
  schedule: "schedule-space.md",
  risk: "risk-planning.md",
  insight: "campus-insight.md",
};

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

function stripDevNote(text) {
  const lines = text.split("\n");
  if (lines[0] && lines[0].startsWith("# ")) {
    let i = 1;
    while (i < lines.length && lines[i].trim() === "") i++;
    if (lines[i] && lines[i].trim().startsWith(">")) {
      while (i < lines.length && (lines[i].trim() === "" || lines[i].trim().startsWith(">"))) i++;
      return lines.slice(0, 1).concat(lines.slice(i)).join("\n").trim();
    }
  }
  return text;
}

function compileFinal(domainName) {
  const sharedSections = SHARED_ORDER.map((f) => read(path.join("shared", f)));
  const domain = stripDevNote(read(domainName));
  const parts = [FINAL_HEADER];
  sharedSections.forEach((s) => {
    parts.push(s);
  });
  parts.push("---\n\n## 域 Prompt\n", domain);
  return parts.join("\n\n") + "\n";
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
  ensureDir(COMPILED_DIR);
  for (const [file, content] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(COMPILED_DIR, file), content, "utf8");
  }
  console.log(`[compiled] ${Object.keys(outputs).length} prompts -> agents/compiled/`);
}

function checkAll(outputs) {
  ensureDir(COMPILED_DIR);
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

function buildFinals() {
  const outputs = {};
  for (const name of DOMAINS) {
    const finalName = name.replace(/\.md$/, ".final.md");
    outputs[finalName] = compileFinal(name);
  }
  return outputs;
}

function writeFinals(outputs) {
  ensureDir(FINAL_DIR);
  for (const [file, content] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(FINAL_DIR, file), content, "utf8");
  }
  console.log(`[final] ${Object.keys(outputs).length} prompts -> ../r50.1/prompts/`);
}

const printArgIdx = process.argv.indexOf("--print");
if (printArgIdx !== -1) {
  const alias = process.argv[printArgIdx + 1];
  const domainFile = DOMAIN_ALIASES[alias];
  if (!domainFile) {
    console.error(`[error] 未知域：${alias}（可用：${Object.keys(DOMAIN_ALIASES).join(" / ")}）`);
    process.exit(1);
  }
  process.stdout.write(compile(domainFile));
} else if (process.argv.includes("--export-final")) {
  writeFinals(buildFinals());
} else {
  const printFinalIdx = process.argv.indexOf("--print-final");
  if (printFinalIdx !== -1) {
    const alias = process.argv[printFinalIdx + 1];
    const domainFile = DOMAIN_ALIASES[alias];
    if (!domainFile) {
      console.error(`[error] 未知域：${alias}（可用：${Object.keys(DOMAIN_ALIASES).join(" / ")}）`);
      process.exit(1);
    }
    process.stdout.write(compileFinal(domainFile));
  } else if (process.argv.includes("--check")) {
    checkAll(buildAll());
  } else {
    writeAll(buildAll());
  }
}