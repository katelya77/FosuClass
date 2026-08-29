#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadDesiredState, CONTROL_ROOT, REPO_ROOT } = require("./lib/desired-state.js");
const { loadLocalConfig, configCapability } = require("./lib/config.js");
const { takeAdpSnapshot, writeSnapshot, writeSummary, SNAPSHOT_PATH } = require("./lib/snapshot.js");
const { diffState } = require("./lib/drift.js");
const { applySafePlan } = require("./lib/apply.js");
const { auditPluginExport, renderAuditMarkdown } = require("./lib/plugin-auditor.js");
const { hashDirectory, deployChangedCode, fetchRemoteCodeHash } = require("./lib/cloudbase-deploy.js");
const { commandExists, run } = require("./lib/process.js");

const args = process.argv.slice(2);
const command = args.shift();
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};

function out(value) {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) throw new Error("No local snapshot. Run npm run adp:snapshot first.");
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
}

function snapshotCommand() {
  const snapshot = takeAdpSnapshot({ input: valueOf("--input") });
  writeSnapshot(snapshot);
  writeSummary(snapshot);
  out({ status: snapshot.observed ? "OBSERVED" : "BLOCKED_UNKNOWN", snapshot: "snapshots/current.local.json", summary: "CURRENT-STATE-SUMMARY.md", reason: snapshot.reason || null });
}

function diffCommand() {
  const result = diffState(loadDesiredState(), readSnapshot());
  const file = path.join(CONTROL_ROOT, "snapshots", "drift.local.json");
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  out(result);
}

function safePlanFromDiff(result) {
  return result.SAFE_AUTOMATABLE.filter((item) => item.patch).map((item) => ({ ...item.patch, patch: {} }));
}

async function applyCommand() {
  const drift = diffState(loadDesiredState(), readSnapshot());
  const plan = safePlanFromDiff(drift);
  if (has("--safe") && has("--confirm")) throw new Error("Tencent ADP safe-write adapter unavailable on this workstation; no mutation performed");
  const result = await applySafePlan({ plan, safe: false, confirm: false });
  out(result);
}

function deployCommand() {
  const desired = loadDesiredState();
  const config = loadLocalConfig();
  const target = "campusflowAdpTools";
  if (!desired.cloudBase.functionAllowlist.includes(target)) throw new Error("target not in desired-state allowlist");
  const dir = path.join(REPO_ROOT, "competition", "adp-kit", "cloudfunctions", target);
  const localHash = hashDirectory(dir);
  const remoteHash = valueOf("--remote-hash") || fetchRemoteCodeHash({ target, envId: config.cloudBaseEnvId });
  const openapi = require(path.join(REPO_ROOT, "competition", "adp-kit", "r49-ma", "tools", "openapi", "campus-agent-tools.adp-import.json"));
  const baseUrl = openapi.servers && openapi.servers[0] && openapi.servers[0].url;
  const healthUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/health` : null;
  const result = deployChangedCode({ target, dir, envId: config.cloudBaseEnvId, localHash, remoteHash, safe: has("--safe"), confirm: has("--confirm"), healthUrl });
  out({ ...result, localHash: `${localHash.slice(0, 12)}…`, remoteHash: remoteHash ? `${remoteHash.slice(0, 12)}…` : null });
}

function auditCommand() {
  const zipPath = args.find((arg) => !arg.startsWith("--"));
  if (!zipPath) throw new Error("Usage: npm run adp:audit:plugin -- <zip-path>");
  const result = auditPluginExport(path.resolve(zipPath));
  fs.writeFileSync(path.join(CONTROL_ROOT, "PLUGIN-EXPORT-AUDIT.md"), renderAuditMarkdown(result, zipPath), "utf8");
  out({ pass: result.pass, yamlCount: result.yamlCount, operations: result.operationIds.length, findings: result.errors.length });
  if (!result.pass) process.exitCode = 1;
}

function runGate(label, executable, commandArgs) {
  out(`[gate] ${label}`);
  const result = run(executable, commandArgs, { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${label} failed (${result.status})`);
}

function preflightCommand() {
  const plugin = valueOf("--plugin");
  const quick = has("--quick");
  runGate("focused control plane", process.execPath, ["--test",
    "competition/adp-kit/r49-ma/tests/test-adp-runtime-control-plane.js",
    "competition/adp-kit/r49-ma/tests/test-adp-plugin-export-auditor.js",
    "competition/adp-kit/r49-ma/tests/test-r51-preference-one-call.js",
  ]);
  runGate("OpenAPI canonical hashes", process.execPath, ["competition/adp-kit/r51/build-openapi-decision-runtime.js", "--check"]);
  if (!quick) {
    runGate("r49-ma all", "npm.cmd", ["--prefix", "competition/adp-kit/r49-ma", "test"]);
    runGate("adp-kit aggregate", "npm.cmd", ["--prefix", "competition/adp-kit", "test"]);
    for (const script of ["test:agent-foundation", "test:agent-regression", "test:ai-competition", "test:agent-final-convergence"]) runGate(script, "npm.cmd", ["run", script]);
  }
  runGate("git diff check", "git.exe", ["diff", "--check"]);
  snapshotCommand();
  diffCommand();
  if (plugin) {
    const saved = args.slice();
    args.length = 0;
    args.push(plugin);
    auditCommand();
    args.length = 0;
    args.push(...saved);
  }
  out("[pass] preflight complete; see MANUAL-CONSOLE-CHECKLIST.md for remaining Console clicks");
}

function capabilityCommand() {
  const config = loadLocalConfig();
  out({
    tcbInstalled: commandExists("tcb"),
    nodeVersion: process.version,
    npmInstalled: commandExists("npm"),
    ghInstalled: commandExists("gh"),
    tccliInstalled: commandExists("tccli"),
    localNonSecretConfig: configCapability(config),
  });
}

Promise.resolve().then(async () => {
  switch (command) {
    case "snapshot": return snapshotCommand();
    case "diff": return diffCommand();
    case "apply": return applyCommand();
    case "deploy-cloudbase": return deployCommand();
    case "audit-plugin": return auditCommand();
    case "preflight": return preflightCommand();
    case "capabilities": return capabilityCommand();
    default: throw new Error("Commands: capabilities | snapshot | diff | apply | deploy-cloudbase | audit-plugin | preflight");
  }
}).catch((error) => {
  process.stderr.write(`[blocked] ${error.message}\n`);
  process.exitCode = 1;
});
