/*
 * R48 Widget V3 — 无外部依赖扫描（零依赖）
 * 断言 r48-v3 全目录（模板/样例/预览/adapter/tests）：
 *   1) 不引用外部网络资源（CDN、字体、图标、远程脚本）
 *   2) 预览 HTML 不发起网络请求
 *   3) 不包含真实学生/教师个人数据
 * 运行：node tests/test-no-external-deps.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");

// 允许的 URL 白名单：仅 JSON Schema 元数据与演示占位符
const ALLOWED_URLS = [
  "json-schema.org",
  "example.invalid",
  "w3.org",
  "schema.org",
];

const FORBIDDEN_PATTERNS = [
  /https?:\/\/cdn\./i,
  /https?:\/\/unpkg\.com/i,
  /https?:\/\/cdnjs\.cloudflare\.com/i,
  /https?:\/\/fonts\.googleapis\.com/i,
  /https?:\/\/fonts\.gstatic\.com/i,
  /https?:\/\/jsdelivr\.net/i,
  /https?:\/\/code\.jquery\.com/i,
];

const FORBIDDEN_FETCH_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\s*\(/,
];

// 样例/预览中允许出现的演示占位数据（与 envelopes 一致），用于排除误报
const ALLOWED_DEMO_ENTITIES = [
  "教师001", "教师002", "教师003", "教师009", "教师030",
  "教室001", "教室002",
  "计科2401", "计科2402",
  "校区A", "校区B", "校区C",
];

const EXCLUDE_DIRS = ["node_modules"];

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else out.push(full);
  }
  return out;
}

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message.split("\n").join("\n    ")}`);
  }
}

console.log("== test-no-external-deps ==");

check("全目录不引用外部 CDN/字体/图标/脚本", () => {
  const files = collectFiles(ROOT);
  assert.ok(files.length > 20, `扫描到文件过少(${files.length})，疑似目录结构异常`);
  for (const file of files) {
    if (!/\.(json|js|html|txt|css)$/i.test(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    // 提取所有 URL
    const urls = content.match(/https?:\/\/[^\s"'`<>]+/g) || [];
    for (const url of urls) {
      const isAllowed = ALLOWED_URLS.some((host) => url.includes(host));
      const isForbidden = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(url));
      assert.ok(
        isAllowed && !isForbidden,
        `${path.relative(ROOT, file)}: 外部资源引用 ${url}`,
      );
    }
  }
});

check("预览 HTML 不发起任何网络请求", () => {
  const preview = fs.readFileSync(path.join(ROOT, "preview", "index.html"), "utf8");
  for (const pattern of FORBIDDEN_FETCH_PATTERNS) {
    assert.ok(!pattern.test(preview), `preview/index.html 包含 ${pattern}`);
  }
  // 只禁止网络引用；本地相对路径（../design-tokens.css、samples.js）允许
  assert.ok(!/<script[^>]+src\s*=\s*["'](?:https?:)?\/\//i.test(preview), "preview/index.html 引用了网络脚本");
  assert.ok(!/<link[^>]+href\s*=\s*["'](?:https?:)?\/\//i.test(preview), "preview/index.html 引用了网络样式");
  assert.ok(!/<img[^>]+src\s*=\s*["'](?:https?:)?\/\//i.test(preview), "preview/index.html 引用了网络图片");
});

check("模板与样例不包含真实学生/教师身份数据（仅演示占位）", () => {
  const files = collectFiles(ROOT);
  for (const file of files) {
    if (!/\.(json|js|html|txt)$/i.test(file)) continue;
    if (file.includes("envelopes")) continue; // envelopes 为演示 fixture
    const content = fs.readFileSync(file, "utf8");
    // 学号：连续 8-12 位数字
    assert.ok(!/\b\d{8,12}\b/.test(content), `${path.relative(ROOT, file)}: 疑似学号`);
    // 排除演示占位实体后的中文姓名检查（仅当出现“教师/同学/学生”上下文中）
    const stripped = ALLOWED_DEMO_ENTITIES.reduce((acc, name) => acc.split(name).join(""), content);
    assert.ok(!/教师\d{4,}/.test(stripped), `${path.relative(ROOT, file)}: 疑似真实教师编号`);
  }
});

if (failures > 0) {
  console.error(`\ntest-no-external-deps: ${failures} 项失败`);
  process.exit(1);
}
console.log("test-no-external-deps: 全部通过");