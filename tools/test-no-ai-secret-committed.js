const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SECRET_PREFIX = "s" + "k-";

const IGNORE_DIRS = new Set([
  ".git",
  ".codex-artifacts",
  "node_modules",
  "server/node_modules",
  "server/storage",
  "storage",
  "temp",
  "tmp",
  "output",
]);

const IGNORE_FILES = new Set([
  ".env",
  ".env.local",
  "server/.env",
  "local.secrets.json",
]);

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".md",
  ".txt",
  ".wxml",
  ".wxss",
  ".ps1",
  ".sh",
  ".yml",
  ".yaml",
  ".env",
  ".example",
  ".conf",
]);

function normalize(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function shouldIgnore(filePath, isDirectory) {
  const rel = normalize(filePath);
  if (!rel) return false;
  if (IGNORE_FILES.has(rel)) return true;
  if (path.basename(rel) === ".env") return true;
  if (rel.endsWith(".secret") || rel.endsWith(".local")) return true;
  const parts = rel.split("/");
  if (parts.some((part, index) => IGNORE_DIRS.has(parts.slice(0, index + 1).join("/")) || IGNORE_DIRS.has(part))) {
    return true;
  }
  if (isDirectory) return false;
  if (/\.(png|jpg|jpeg|gif|webp|ico|zip|gz|pdf|xlsx|xls|har)$/i.test(rel)) return true;
  const ext = path.extname(rel).toLowerCase();
  return ext && !TEXT_EXTENSIONS.has(ext);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (shouldIgnore(fullPath, entry.isDirectory())) continue;
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function findLeaks(text) {
  const leaks = [];
  const providerSecret = new RegExp(`${SECRET_PREFIX}[A-Za-z0-9][A-Za-z0-9_-]{16,}`, "g");
  const bearerToken = new RegExp("(Authorization[ \\t]*[:=][ \\t]*)?Bearer[ \\t]+(?!YOUR_|example|test|mock|dummy)[A-Za-z0-9._~+\\/-]{24,}", "gi");
  [providerSecret, bearerToken].forEach((re) => {
    let match;
    while ((match = re.exec(text)) !== null) {
      leaks.push({ rule: re === providerSecret ? "provider-secret-prefix" : "bearer-token", sample: match[0].slice(0, 32) });
    }
  });

  String(text || "").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^[ \t]*["']?[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*["']?[ \t]*[:=][ \t]*["']?([^"'\s#;,]{24,})/);
    if (!match) return;
    const value = match[1];
    if (/^(YOUR_|example|test|mock|dummy|unit-test|placeholder|REDACTED|dev-|local-|process\.env|\$\{\{|config\.|source\.|result\.|manifest\.|payload\.|activeInfo\.)/i.test(value)) {
      return;
    }
    if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value)) return;
    leaks.push({ rule: "secret-assignment", sample: line.slice(0, 32) });
  });
  return leaks;
}

function run() {
  const leaks = [];
  walk(ROOT).forEach((file) => {
    const rel = normalize(file);
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      return;
    }
    findLeaks(text).forEach((leak) => {
      leaks.push({ file: rel, rule: leak.rule, sample: leak.sample });
    });
  });

  assert.strictEqual(
    leaks.length,
    0,
    leaks.map((item) => `${item.file} ${item.rule} ${item.sample}`).join("\n")
  );

  console.log("test-no-ai-secret-committed passed");
}

run();
