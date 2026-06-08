const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVER_SRC = path.join(ROOT, "server", "src");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

function toRepoPath(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function inspectFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const violations = [];
  const literalPatterns = [
    /require\s*\(\s*["']\.\.\/\.\.\/\.\.\/\.\.\/shared(?:\/|["'])/g,
    /require\s*\(\s*["']\.\.\/miniprogram(?:\/|["'])/g,
    /require\s*\(\s*["']\.\.\/\.\.\/miniprogram(?:\/|["'])/g,
    /require\s*\(\s*["']\.\.\/\.\.\/\.\.\/miniprogram(?:\/|["'])/g,
  ];
  literalPatterns.forEach((pattern) => {
    if (pattern.test(text)) violations.push("forbidden literal require path");
  });

  const requirePattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = requirePattern.exec(text)) !== null) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const resolved = path.resolve(path.dirname(file), specifier);
    const repoPath = path.relative(ROOT, resolved).replace(/\\/g, "/");
    if (repoPath === "shared" || repoPath.startsWith("shared/")) {
      violations.push(`runtime require resolves to root shared: ${specifier}`);
    }
    if (repoPath === "miniprogram" || repoPath.startsWith("miniprogram/")) {
      violations.push(`runtime require resolves to miniprogram: ${specifier}`);
    }
  }
  return violations.map((message) => `${toRepoPath(file)}: ${message}`);
}

function run() {
  const violations = walk(SERVER_SRC).flatMap(inspectFile);
  assert.strictEqual(violations.length, 0, violations.join("\n"));
  console.log("test-server-no-root-shared-require passed");
}

run();
