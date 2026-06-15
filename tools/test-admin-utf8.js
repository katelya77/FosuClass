const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const adminPagesPath = path.join(root, "server", "src", "routes", "adminPages.js");
const adminApiPath = path.join(root, "server", "src", "routes", "admin.js");

const mojibakeNeedles = [
  "姝ｅ湪",
  "鑾峰彇",
  "绯荤粺",
  "鐘舵",
  "杩愮淮",
  "鎸囧崡",
  "锛",
  "鈥",
  "鐨",
  "鍚",
  "銆",
];

function assertNoNeedles(text, fileLabel) {
  mojibakeNeedles.forEach((needle) => {
    assert(!text.includes(needle), `${fileLabel} contains mojibake needle ${needle}`);
  });
}

function run() {
  const adminPagesSource = fs.readFileSync(adminPagesPath, "utf8");
  const adminApiSource = fs.readFileSync(adminApiPath, "utf8");
  const adminRouter = require("../server/src/routes/adminPages");
  const html = adminRouter.adminConsoleHtml;

  assert.strictEqual(Buffer.from(adminPagesSource, "utf8").toString("utf8"), adminPagesSource, "adminPages must be readable as UTF-8");
  assert.strictEqual(Buffer.from(html, "utf8").toString("utf8"), html, "admin HTML must be UTF-8");

  assertNoNeedles(adminPagesSource, "adminPages.js");
  assertNoNeedles(html, "admin HTML");

  assert(html.includes("正在获取系统同步状态与运维指南"), "admin sync loading copy must be normal Chinese");
  assert(adminPagesSource.includes('res.setHeader("Content-Type", "text/html; charset=utf-8")'), "admin HTML must declare UTF-8");
  assert(adminApiSource.includes('function setJsonUtf8(res)'), "admin JSON helper missing");
  assert(adminApiSource.includes('res.setHeader("Content-Type", "application/json; charset=utf-8")'), "admin JSON must declare UTF-8");
  assert(/router\.get\("\/sync\/status"[\s\S]*?setJsonUtf8\(res\)/.test(adminApiSource), "sync status API must set JSON UTF-8");
  assert(/router\.get\("\/publisher\/receipt"[\s\S]*?setJsonUtf8\(res\)/.test(adminApiSource), "publisher receipt API must set JSON UTF-8");

  console.log("test-admin-utf8 passed");
}

run();
