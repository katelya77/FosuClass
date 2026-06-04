const assert = require("assert");
const childProcess = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const clientDir = path.join(projectRoot, "tools", "fosu-sync-client");
const syncPath = path.join(clientDir, "sync.js");
const expected = path.join(projectRoot, "staging", "2025-2026-2-full.json");

function resolveFrom(cwd, fileArg) {
  const code = [
    `const sync = require(${JSON.stringify(syncPath)});`,
    `process.stdout.write(sync.resolveOutputFilePath(${JSON.stringify(fileArg)}));`,
  ].join("");
  return childProcess.execFileSync(process.execPath, ["-e", code], {
    cwd,
    encoding: "utf-8",
    env: Object.assign({}, process.env, {
      NODE_ENV: "test",
      FOSU_API_BASE: "https://class.katelya.eu.org",
    }),
  }).trim().split(/\r?\n/).pop();
}

function run() {
  assert.strictEqual(resolveFrom(projectRoot, "./staging/2025-2026-2-full.json"), expected);
  assert.strictEqual(resolveFrom(clientDir, "./staging/2025-2026-2-full.json"), expected);
  assert.strictEqual(resolveFrom(projectRoot, "staging/2025-2026-2-full.json"), expected);
  console.log("test-sync-output-paths passed");
}

run();
