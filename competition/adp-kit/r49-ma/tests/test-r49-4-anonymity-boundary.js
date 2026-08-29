"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const COMPETITION = path.resolve(__dirname, "..", "..", "..");
const ADP_KIT = path.join(COMPETITION, "adp-kit");
const R49_MA = path.join(ADP_KIT, "r49-ma");
const SUBMISSION = path.join(COMPETITION, "submission-package");
const DATA_HUB = path.join(R49_MA, "data-hub");

const BUILDER = path.join(ADP_KIT, "build-submission-package.js");
const REGISTER = path.join(R49_MA, "10-MIGRATION-RISK-REGISTER.md");

// 测试专用 denylist 常量：只存在于本测试文件，绝不复制进生成资产（privacy-policy.json 不拷贝本清单）
const IDENTITY_DENYLIST = ["佛山大学", "佛山市", "佛山科学技术学院", "katelya", "思囿"];
const GATE_FILES_BY_PATH = [
  path.join(ADP_KIT, "mock-data", "validate-competition-demo-v1.js"),
  path.join(ADP_KIT, "mock-data", "validate-competition-demo-v2.js"),
  path.join(COMPETITION, "submission-package", "tools", "validate-submission-package.js"),
  path.join(ADP_KIT, "evaluation", "eval-dataset-v1.json"),
  path.join(ADP_KIT, "evaluation", "eval-golden.js"),
];

const DUMMY_VALUE_RE = /^(?:test|dummy|example|mock|unit|fake|sample|placeholder|synthetic)[_-]?/i;

const CREDENTIAL_PATTERNS = [
  { re: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i, label: "password 字面量" },
  { re: /(?:cookie|session[_-]?id|jsessionid)\s*[:=]\s*["'][^"']{8,}["']/i, label: "cookie/session 字面量" },
  { re: /authorization\s*[:=]\s*[Bb]earer\s+[A-Za-z0-9._\-]{16,}/, label: "authorization bearer 值" },
  { re: /(?:api[_-]?key|secret|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, label: "api key/secret/token 字面量" },
  { re: /(?:账号|密码|学号)\s*[:：=]\s*\S{6,}/, label: "账号/密码/学号值" },
  { re: /[A-Za-z0-9+/]{40,}={1,2}/, label: "疑似 base64 长串（带填充）" },
];

function valueOf(matchText) {
  const eq = matchText.search(/[:=]/);
  if (eq < 0) return "";
  return matchText.slice(eq + 1).trim().replace(/^["']/, "").replace(/["']$/, "");
}

function isDummyMatch(matchText, label) {
  if (label.includes("base64")) return false;
  return DUMMY_VALUE_RE.test(valueOf(matchText));
}

const PRIVATE_EXTENSIONS = [".xls", ".xlsx"];
const PERSONAL_FILENAME_RE = /^\d{9,}|(?:^|_)(?:学号|student|学工号)[\w-]*/i;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// 镜像 build-submission-package.js 的打包白名单（submission 输入 = 会被打包进提交包的输入）
function submissionInputFiles() {
  const out = [];
  const copyDir = (rel, accept) => {
    const root = path.join(ADP_KIT, rel);
    if (!fs.existsSync(root)) return;
    for (const file of walk(root)) {
      const relFromRoot = path.relative(root, file).replace(/\\/g, "/");
      if (accept(relFromRoot)) out.push(file);
    }
  };
  copyDir("mock-data", () => true);
  copyDir("knowledge", (f) => /\.md$/.test(f));
  copyDir("qa", (f) => /\.(?:json|csv|md)$/.test(f));
  copyDir("workflows", (f) => /^(?:0[1-4]-.*\.md|workflow-specs\.json|application-config\.json|role-instruction\.txt)$/.test(f));
  copyDir("widget", (f) => /^(?:index\.html|styles\.css|widget\.js|widget-schema\.json|sample-results\.(?:json|js)|校园任务结果卡\.md)$/.test(f));
  copyDir("evaluation", (f) => /^(?:evaluation-dataset\.(?:json|jsonl|csv)|golden-results\.json|golden-cases\.js|golden-oracle\.js|eval-golden\.js|scoring-rubric\.md)$/.test(f));
  copyDir("mcp/campus-tools-mcp/src", (f) => /\.(?:js|ts)$/.test(f));
  copyDir("mcp/campus-tools-mcp/test", (f) => /\.test\.js$/.test(f));
  for (const f of ["package.json", "package-lock.json", "tsconfig.json"]) {
    const p = path.join(ADP_KIT, "mcp", "campus-tools-mcp", f);
    if (fs.existsSync(p)) out.push(p);
  }
  const openapi = path.join(ADP_KIT, "openapi", "campus-tools.openapi.json");
  if (fs.existsSync(openapi)) out.push(openapi);
  return out;
}

test("契约 1：privacy-policy.json 存在且声明个人导入边界（不入包、不凭据、不原始导入）", () => {
  const policyPath = path.join(DATA_HUB, "privacy-policy.json");
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  assert.strictEqual(policy.version, "R49.4");
  assert.strictEqual(policy.principles.personalImportStorage, "excluded");
  assert.strictEqual(policy.principles.rawImportAllowed, false);
  assert.strictEqual(policy.principles.credentialed, false);
  assert.strictEqual(policy.principles.modelExposure, "none");
  assert.strictEqual(policy.principles.submissionPackaging, "anonymous-only");
  const policyText = JSON.stringify(policy);
  assert.ok(!IDENTITY_DENYLIST.some((s) => policyText.includes(s)), "denylist 常量不得被拷贝进配置资产");
});

test("契约 2：data-hub fixtures 不得出现个人/私有源文件（.xls/.xlsx 或个人信息文件名）", () => {
  const fixturesDir = path.join(R49_MA, "tests", "fixtures");
  const files = walk(fixturesDir);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    assert.ok(!PRIVATE_EXTENSIONS.includes(ext), `fixture 目录不得出现私有源文件：${path.relative(COMPETITION, file)}`);
    const base = path.basename(file);
    assert.ok(!PERSONAL_FILENAME_RE.test(base), `fixture 文件名不得携带个人信息：${base}`);
  }
});

test("契约 3：submission 输入与生成包不得出现凭据/Token/Cookie 模式", () => {
  const scanned = [...submissionInputFiles(), ...walk(SUBMISSION), ...walk(R49_MA)];
  const violations = [];
  for (const file of scanned) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    for (const { re, label } of CREDENTIAL_PATTERNS) {
      if (path.basename(file) === "package-lock.json" && label.includes("base64")) continue;
      const m = text.match(re);
      if (m && !isDummyMatch(m[0], label)) violations.push(`${path.relative(COMPETITION, file)}: ${label} → ${JSON.stringify(m[0].slice(0, 40))}`);
    }
  }
  assert.deepStrictEqual(violations, [], "不得存在凭据/Token/Cookie 值");
});

test("契约 4：submission 敏感路径不得出现真实学校身份（denylist 为测试专用常量）", () => {
  const scanned = [...submissionInputFiles(), ...walk(SUBMISSION)];
  for (const file of GATE_FILES_BY_PATH) {
    const idx = scanned.indexOf(file);
    if (idx >= 0) scanned.splice(idx, 1);
  }
  const violations = [];
  for (const file of scanned) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    for (const word of IDENTITY_DENYLIST) {
      if (text.includes(word)) violations.push(`${path.relative(COMPETITION, file)}: 含「${word}」`);
    }
  }
  assert.deepStrictEqual(violations, [], "提交敏感路径不得出现真实学校/个人身份");
});

test("契约 5：r49-ma 文档（prompts/policies/reports）与 data-hub 不得出现真实学校/个人身份", () => {
  const scanned = walk(R49_MA).filter((f) => !f.includes(`${path.sep}tests${path.sep}`));
  const violations = [];
  for (const file of scanned) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    for (const word of IDENTITY_DENYLIST) {
      if (text.includes(word)) violations.push(`${path.relative(COMPETITION, file)}: 含「${word}」`);
    }
  }
  assert.deepStrictEqual(violations, [], "r49-ma 文档不得出现真实身份");
});

test("契约 6：build-submission-package.js 必须显式拒绝 personal-import / raw-import 目录", () => {
  const builder = fs.readFileSync(BUILDER, "utf8");
  assert.ok(builder.includes("personal-import"), "builder 必须显式排除 personal-import");
  assert.ok(builder.includes("raw-import"), "builder 必须显式排除 raw-import");
  assert.ok(!builder.includes("competition-demo-v2"), "builder 不得引用/改造 v2 行为");
});

test("契约 7：风险登记簿 #16 记录个人导入泄漏治理（含 privacy-policy 与匿名测试）", () => {
  const register = fs.readFileSync(REGISTER, "utf8");
  assert.ok(register.includes("privacy-policy.json"), "登记簿必须引用 privacy-policy.json");
  assert.ok(register.includes("test-r49-4-anonymity-boundary"), "登记簿必须引用匿名边界测试");
  assert.ok(register.includes("personal-import"), "登记簿必须声明 personal-import 排除");
});