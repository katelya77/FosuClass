const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const roots = [path.join(root, "server", "src"), path.join(root, "server", "scripts")];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

const violations = [];
for (const file of roots.flatMap((dir) => walk(dir))) {
  const text = fs.readFileSync(file, "utf8");
  const pattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const resolved = path.resolve(path.dirname(file), specifier);
    const relative = path.relative(root, resolved).replace(/\\/g, "/");
    if (relative === "deploy" || relative.startsWith("deploy/") || relative === "miniprogram" || relative.startsWith("miniprogram/")) {
      violations.push(`${path.relative(root, file)} -> ${specifier}`);
    }
  }
}
assert.deepStrictEqual(violations, []);
require("../server/src/security/campusAgentSignature");
require("../server/src/routes/campusAgent");
console.log("server-production-runtime-boundary PASS");
