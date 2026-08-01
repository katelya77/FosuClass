#!/usr/bin/env node
/**
 * Unified Xiaofu Agent release gate — single definition for local, PR CI, and Deploy to VPS.
 * Fail-fast on first failing suite. Does not delete/weaken checks.
 *
 * Global rule: a step whose captured output contains "UNVERIFIED" is treated as
 * FAILED even when its exit code is 0. UNVERIFIED is the honest marker used by
 * environment-dependent suites (browser, docker, real provider); at the gate it
 * must stay visible instead of silently passing. Positional CLI args filter the
 * step list by script-name substring (local debugging only; the gate runs all).
 */
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const STEPS = [
  ["test:agent-reliability-convergence", "Real-device reliability and product convergence"],
  ["test:agent-platform-p1", "Product platform P1 production wiring"],
  ["test:agent-platform-p2", "Product platform P2 model-first runtime and budgets"],
  ["test:agent-platform-p3", "Product platform P3 context and memory"],
  ["test:agent-platform-p4a", "Product platform P4a config publication kernel"],
  ["test:agent-platform-p4b", "Product platform P4b hot-publish core runtime domains"],
  ["test:agent-platform-p4c", "Product platform P4c governed MCP runtime"],
  ["test:agent-platform-p4d", "Product platform P4d versioned hybrid RAG runtime"],
  ["test:agent-platform-p4e", "Product platform P4e agent control plane"],
  ["test:agent-platform-p5a", "Product platform P5a standalone durable storage"],
  ["test:agent-platform-p5b", "Product platform P5b standalone service topology"],
  ["test:agent-platform-p7a", "Product platform P7a engine adapter contract and conformance"],
  ["test:xiaofu-final-suite", "Open-schedule / AG-UI / Coze / college / UI final + core experience"],
  ["test:xiaofu-core-experience", "Core experience: follow-up / college A-B / voice / geometry"],
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
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
    shell: isWin,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.error) throw result.error;
  const unverified = /UNVERIFIED/.test(output);
  return { ok: result.status === 0, unverified };
}

function main() {
  console.log("=== Xiaofu Agent Release Gate ===");
  console.log(`root=${ROOT}`);
  const filters = process.argv.slice(2);
  const steps = filters.length
    ? STEPS.filter(([script]) => filters.some((needle) => script.indexOf(needle) >= 0))
    : STEPS;
  if (!steps.length) {
    console.error(`no gate step matches filter: ${filters.join(", ")}`);
    process.exit(1);
  }
  console.log(`steps=${steps.length}${filters.length ? ` (filtered from ${STEPS.length})` : ""}`);
  const started = Date.now();
  const results = [];

  for (const [script, label] of steps) {
    console.log(`\n--- [${label}] npm run ${script} ---`);
    const outcome = runNpm(script);
    const ok = outcome.ok && !outcome.unverified;
    results.push({ script, label, ok });
    if (!ok) {
      if (outcome.ok && outcome.unverified) {
        console.error(`\nGATE FAILED at ${script} (${label}): output contains UNVERIFIED — ` +
          "an environment-dependent suite did not actually run; the gate treats unverified as failed");
      } else {
        console.error(`\nGATE FAILED at ${script} (${label})`);
      }
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
