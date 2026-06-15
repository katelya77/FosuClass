#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function run(label, command, args, options = {}) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  const startedAt = Date.now();
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32" && command === "npm",
    env: Object.assign({}, process.env, options.env || {}),
  });
  return {
    label,
    command: [command].concat(args || []).join(" "),
    ok: result.status === 0,
    status: result.status,
    durationMs: Date.now() - startedAt,
    stdout: String(result.stdout || "").slice(-1200),
    stderr: String(result.stderr || result.error && result.error.message || "").slice(-1200),
  };
}

function hasEnv(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function activeReleaseReadable() {
  const candidates = [
    path.join(ROOT, "server", "storage", "public", "runtime", "active.json"),
    path.join(ROOT, "server", "storage", "static", "runtime", "active.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && (parsed.releaseVersion || parsed.version)) {
        return { ok: true, file, releaseVersion: parsed.releaseVersion || parsed.version };
      }
    } catch (_) {}
  }
  return { ok: false, reason: "No local runtime/active.json release pointer is available." };
}

function secretScan() {
  const result = run("git secret scan", "git", [
    "grep",
    "-nE",
    "(AIza[0-9A-Za-z_-]{20,}|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|(^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{20,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|JSESSIONID=[A-Za-z0-9._-]{16,}|Cookie: [A-Za-z0-9]{16,}|Authorization: Bearer [A-Za-z0-9]{16,})",
    "--",
    ".",
    ":!tools/release-check.js",
    ":!tools/test-*.js",
    ":!package-lock.json",
    ":!server/package-lock.json",
  ]);
  return {
    label: "no committed obvious secrets",
    ok: result.status === 1,
    status: result.status,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function syntaxChecks() {
  return [
    run("publisher syntax", "node", ["--check", "tools/fosu-publisher/publish.js"]),
    run("cloudbase live-smoke syntax", "node", ["--check", "tools/cloudbase/live-smoke.js"]),
    run("publisher receipt service syntax", "node", ["--check", "server/src/services/publisherReceiptService.js"]),
    run("ai provider store syntax", "node", ["--check", "server/src/services/ai/providerRuntimeConfigStore.js"]),
    run("admin route syntax", "node", ["--check", "server/src/routes/admin.js"]),
  ];
}

function localProductionTests() {
  return [
    run("canonical stable sorting", "node", ["tools/test-staging-fingerprint.js"]),
    run("publisher integration", "node", ["tools/test-fosu-publisher.js"]),
    run("publisher receipt storage", "node", ["tools/test-publisher-receipts.js"]),
    run("ai provider encryption", "node", ["tools/test-ai-provider-runtime-config-store.js"]),
    run("ai runtime modes", "node", ["tools/test-ai-runtime-modes-and-cloudbase.js"]),
    run("cloudbase release tools", "node", ["tools/test-cloudbase-release-tools.js"]),
    run("cloudbase live smoke", "node", ["tools/test-cloudbase-live-smoke.js"]),
    run("cloudbase static origin", "node", ["tools/test-cloudbase-static-origin.js"]),
  ];
}

function preflight() {
  const checks = []
    .concat(syntaxChecks())
    .concat(localProductionTests())
    .concat([
      run("runtime readiness", "npm", ["run", "test:runtime-readiness"]),
      run("security full", "npm", ["run", "test:security-full"]),
      run("git diff whitespace", "git", ["diff", "--check"]),
      secretScan(),
    ]);
  return { mode: "preflight", checks, blockers: [] };
}

function experience() {
  const checks = []
    .concat(syntaxChecks())
    .concat([
      run("publisher integration", "node", ["tools/test-fosu-publisher.js"]),
      run("cloudbase static origin", "node", ["tools/test-cloudbase-static-origin.js"]),
      run("miniprogram build metadata", "node", ["tools/generate-miniprogram-build-info.js", "--dry-run"]),
      run("git diff whitespace", "git", ["diff", "--check"]),
      secretScan(),
    ]);
  const blockers = [];
  const runtimeMode = String(process.env.AI_RUNTIME_MODE || "public").toLowerCase();
  checks.push({ label: "public runtime mode", ok: runtimeMode !== "competition", runtimeMode });
  if (runtimeMode === "competition") blockers.push("AI_RUNTIME_MODE is competition; experience/formal release requires public.");
  const active = activeReleaseReadable();
  checks.push({ label: "local active release pointer readable", ok: active.ok, active });
  if (!active.ok) blockers.push(active.reason);
  if (!hasEnv("ADMIN_API_TOKEN") && !hasEnv("ADMIN_TOKEN")) blockers.push("ADMIN_API_TOKEN or ADMIN_TOKEN is not available for live server checks.");
  if (!hasEnv("FOSU_CLOUDBASE_STATIC_BASE_URL") && !hasEnv("CLOUDBASE_STATIC_BASE_URL")) blockers.push("CloudBase static hosting base URL is not configured for live dual-source check.");
  return { mode: "experience", checks, blockers, canUploadExperience: false };
}

function formal() {
  const result = experience();
  result.mode = "formal";
  const blockers = result.blockers;
  if (String(process.env.AI_RUNTIME_MODE || "public").toLowerCase() !== "public") {
    blockers.push("Formal release requires AI_RUNTIME_MODE=public.");
  }
  if (hasEnv("AI_COMPETITION_OPENID_WHITELIST") || hasEnv("FOSU_AI_COMPETITION_OPENID_WHITELIST")) {
    blockers.push("Competition OPENID whitelist is configured; remove/disable it for formal release.");
  }
  if (!fs.existsSync(path.join(ROOT, "miniprogram", "privacy.json")) &&
      !fs.existsSync(path.join(ROOT, "docs", "privacy.md")) &&
      !fs.existsSync(path.join(ROOT, "miniprogram", "pages", "settings", "settings.wxml"))) {
    blockers.push("Privacy document entry was not found.");
  }
  result.canSubmitFormal = false;
  return result;
}

function summarize(result) {
  const failed = result.checks.filter((item) => item.ok === false);
  const ok = failed.length === 0 && result.blockers.length === 0;
  if (result.mode === "experience") result.canUploadExperience = ok;
  if (result.mode === "formal") result.canSubmitFormal = ok;
  console.log(JSON.stringify({
    mode: result.mode,
    ok,
    failed: failed.map((item) => ({ label: item.label, status: item.status, stdout: item.stdout, stderr: item.stderr })),
    blockers: result.blockers,
    canUploadExperience: result.canUploadExperience,
    canSubmitFormal: result.canSubmitFormal,
  }, null, 2));
  if (result.mode === "experience") console.log(`canUploadExperience=${ok ? "true" : "false"}`);
  if (result.mode === "formal") console.log(`canSubmitFormal=${ok ? "true" : "false"}`);
  return ok;
}

const mode = String(process.argv[2] || "preflight").replace(/^--mode=/, "");
const result = mode === "experience"
  ? experience()
  : mode === "formal"
    ? formal()
    : preflight();
const ok = summarize(result);
process.exit(ok ? 0 : 1);
