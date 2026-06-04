const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "miniprogram");
const forbidden = [
  "ADMIN_API_TOKEN",
  "ADMIN_TOKEN",
  "ADMIN_PASSWORD",
  "AppSecret",
  "appsecret",
  "WECHAT_UPLOAD_PRIVATE_KEY",
  "private_key",
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() ? [fullPath] : [];
  });
}

const offenders = [];
walk(ROOT)
  .filter((filePath) => /\.(js|json|wxml|wxss)$/.test(filePath))
  .forEach((filePath) => {
    const text = fs.readFileSync(filePath, "utf-8");
    forbidden.forEach((token) => {
      if (text.includes(token)) {
        offenders.push(`${path.relative(ROOT, filePath)}:${token}`);
      }
    });
  });

assert.strictEqual(offenders.length, 0, `miniprogram contains forbidden secret markers: ${offenders.join(", ")}`);
console.log("test-no-secret-in-miniprogram passed");
