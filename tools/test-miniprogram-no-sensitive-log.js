const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "miniprogram");
const sensitivePatterns = [
  /ADMIN_API_TOKEN\s*[:=]/i,
  /AppSecret\s*[:=]/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /cookie\s*[:=]\s*["'][^"']+["']/i,
];

function walk(dir, files = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(js|wxml|json)$/.test(entry.name)) files.push(full);
  });
  return files;
}

const offenders = [];
walk(root).forEach((file) => {
  const text = fs.readFileSync(file, "utf8");
  sensitivePatterns.forEach((pattern) => {
    if (pattern.test(text)) offenders.push(`${path.relative(root, file)}:${pattern}`);
  });
});

assert.deepStrictEqual(offenders, [], `sensitive values found: ${offenders.join(", ")}`);
console.log("test-miniprogram-no-sensitive-log passed");
