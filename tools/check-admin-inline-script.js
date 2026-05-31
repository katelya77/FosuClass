const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

process.env.NODE_ENV = "development";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";

const adminPagesPath = path.join(__dirname, "../server/src/routes/adminPages.js");
const tmpDir = path.join(__dirname, "../.tmp");
const tmpJsPath = path.join(tmpDir, "admin-inline.js");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function extractFunctionBody(source, functionName) {
  const match = new RegExp("\\bfunction\\s+" + functionName + "\\s*\\(").exec(source);
  if (!match) return "";

  const openBrace = source.indexOf("{", match.index);
  if (openBrace < 0) return "";

  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(openBrace + 1, i);
    }
  }

  return "";
}

function getFunctionNames(source) {
  const names = new Set();
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    names.add(match[1]);
  }
  return names;
}

function getDirectCalls(source) {
  const calls = new Set();
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    calls.add(match[2]);
  }
  return calls;
}

if (!fs.existsSync(adminPagesPath)) {
  fail(`Error: ${adminPagesPath} not found`);
}

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

let router;
try {
  router = require(adminPagesPath);
} catch (error) {
  fail(`Failed to require adminPages.js: ${error.stack || error.message}`);
}

const html = router.adminConsoleHtml;
if (!html) {
  fail("adminConsoleHtml not exported or empty");
}

const htmlLines = html.split(/\r?\n/);
const originalLines = fs.readFileSync(adminPagesPath, "utf-8").split(/\r?\n/);

let offset = 0;
for (let i = 0; i < originalLines.length; i += 1) {
  if (originalLines[i].includes("const adminConsoleHtml = `")) {
    offset = i + 1;
    break;
  }
}

let inScript = false;
const outputLines = Array(offset).fill("");

for (const line of htmlLines) {
  if (line.includes("<script>") || line.includes("<script ")) {
    inScript = true;
    outputLines.push("");
    continue;
  }
  if (line.includes("</script>")) {
    inScript = false;
    outputLines.push("");
    continue;
  }

  outputLines.push(inScript ? line : "");
}

const scriptSource = outputLines.join("\n");
fs.writeFileSync(tmpJsPath, scriptSource, "utf-8");

try {
  execFileSync(process.execPath, ["--check", tmpJsPath], { stdio: "pipe" });
} catch (error) {
  console.error("Admin Console inline script syntax check failed.\n");
  const stderr = error.stderr ? error.stderr.toString() : error.message;
  console.error(stderr);

  const match = stderr.match(/admin-inline\.js:(\d+)/);
  if (match) {
    const errorLineNum = parseInt(match[1], 10);
    console.error(`\nError location in server/src/routes/adminPages.js around line ${errorLineNum}:\n`);

    const start = Math.max(1, errorLineNum - 5);
    const end = Math.min(originalLines.length, errorLineNum + 5);
    for (let idx = start; idx <= end; idx += 1) {
      const marker = idx === errorLineNum ? ">> " : "   ";
      console.error(`${marker}${String(idx).padStart(4, " ")}: ${originalLines[idx - 1]}`);
    }
  }
  process.exit(1);
}

const functionNames = getFunctionNames(scriptSource);
const requiredFunctions = [
  "login",
  "logout",
  "loadDashboard",
  "loadConfig",
  "loadNotices",
  "loadNews",
  "loadFeedbacks",
  "renderDashboard",
];

const missingRequired = requiredFunctions.filter((name) => !functionNames.has(name));
if (missingRequired.length > 0) {
  fail(`Admin Console inline script is missing required functions: ${missingRequired.join(", ")}`);
}

const loadAllBody = extractFunctionBody(scriptSource, "loadAll");
if (!loadAllBody) {
  fail("Admin Console inline script is missing loadAll().");
}
if (!loadAllBody.includes("Promise.allSettled")) {
  fail("loadAll() must use Promise.allSettled so one failed module does not block the whole dashboard.");
}

const ignoredCalls = new Set([
  "Array",
  "Date",
  "Error",
  "JSON",
  "Number",
  "Object",
  "Promise",
  "String",
  "catch",
  "for",
  "function",
  "if",
  "parseInt",
  "return",
  "setTimeout",
  "switch",
  "typeof",
  "while",
]);

const missingLoadAllCalls = Array.from(getDirectCalls(loadAllBody))
  .filter((name) => !ignoredCalls.has(name))
  .filter((name) => !functionNames.has(name));

if (missingLoadAllCalls.length > 0) {
  fail(`loadAll() calls functions that are not defined: ${missingLoadAllCalls.join(", ")}`);
}

try {
  fs.unlinkSync(tmpJsPath);
} catch (error) {}

console.log("Admin Console inline script syntax and static checks passed.");
