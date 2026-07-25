#!/usr/bin/env node
/**
 * Unified Xiaofu Agent release gate — single definition for local, PR CI, and Deploy to VPS.
 * Fail-fast on first failing suite. Does not delete/weaken checks.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const STEPS = [
  ["test:agent-memory-autonomy", "Memory + autonomy wiring"],
  ["test:agent-foundation", "Agent foundation"],
  ["test:agent-regression", "Agent regression"],
  ["test:agent-final-convergence", "Final convergence"],
  ["test:agent-task-gates", "Task book chapter gates"],
  ["test:agent-phase3", "Runtime truth / phase3"],
  ["test:ai-competition", "AI competition suite"],
  ["test:miniprogram-package-hygiene", "Miniprogram package hygiene"],
  ["test:server-ai-module-require", "Server AI module require"],
  ["test:server-docker-smoke", "Server docker smoke"],
  ["release:preflight", "Release preflight"],
  ["security:acceptance", "Security acceptance"],
];

function runNpm(script) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";
  const result = spawnSync(cmd, ["run", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
    shell: isWin,
  });
  return result.status === 0;
}

function main() {
  console.log("=== Xiaofu Agent Release Gate ===");
  console.log(`root=${ROOT}`);
  console.log(`steps=${STEPS.length}`);
  const started = Date.now();
  const results = [];

  for (const [script, label] of STEPS) {
    console.log(`\n--- [${label}] npm run ${script} ---`);
    const ok = runNpm(script);
    results.push({ script, label, ok });
    if (!ok) {
      console.error(`\nGATE FAILED at ${script} (${label})`);
      results.forEach((r) => console.error(`  ${r.ok ? "OK" : "FAIL"}  ${r.script}`));
      process.exit(1);
    }
  }

  const ms = Date.now() - started;
  console.log("\n=== Gate passed ===");
  results.forEach((r) => console.log(`  OK  ${r.script}`));
  console.log(`durationMs=${ms}`);
  process.exit(0);
}

main();
