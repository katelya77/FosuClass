#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { runProcess } = require("./shared/processRunner");
const {
  getPublisherAdminToken,
  isCiEnvironment,
} = require("./fosu-publisher/admin-token-utils");

const ROOT = path.resolve(__dirname, "..");

function run(label, command, args, options = {}) {
  const startedAt = Date.now();
  const result = runProcess(command, args || [], {
    cwd: ROOT,
    encoding: "utf8",
    env: Object.assign({}, process.env, options.env || {}),
    timeoutMs: options.timeoutMs || 0,
  });
  return {
    label,
    command: [command].concat(result.safeArgs || args || []).join(" "),
    ok: result.ok,
    status: result.status,
    durationMs: Date.now() - startedAt,
    stdout: String(result.stdoutTail || result.stdout || "").slice(-1200),
    stderr: String(result.stderrTail || result.error && result.error.message || "").slice(-1200),
    errorCode: result.error && result.error.code || "",
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

function configuredCloudbaseStaticBase(config) {
  return String(
    process.env.FOSU_CLOUDBASE_STATIC_BASE_URL ||
    process.env.CLOUDBASE_STATIC_BASE_URL ||
    config.CLOUDBASE_HOSTING_BASE_URL ||
    ""
  ).trim();
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

function configCheck(label, ok, details) {
  return {
    label,
    ok: Boolean(ok),
    status: ok ? 0 : 1,
    durationMs: 0,
    stdout: details ? JSON.stringify(details).slice(-1200) : "",
    stderr: ok ? "" : (details && details.message || `${label} failed`),
  };
}

function readCloudbaseConfig() {
  delete require.cache[require.resolve("../miniprogram/config/cloudbase")];
  return require("../miniprogram/config/cloudbase");
}

function voiceGateCheck(formal = false) {
  const config = readCloudbaseConfig();
  const enabled = config.AI_VOICE_INPUT_ENABLED === true;
  const provider = String(config.AI_VOICE_PROVIDER || "");
  const providerReady = !enabled || provider === "cloudbase-function";
  const ok = providerReady || (formal && !enabled);
  return configCheck("voice feature gate", ok, {
    enabled,
    provider,
    formal,
    message: ok ? "" : "AI voice input is enabled but AI_VOICE_PROVIDER is not available.",
  });
}

function syntaxChecks() {
  return [
    run("process runner syntax", "node", ["--check", "tools/shared/processRunner.js"]),
    run("publisher syntax", "node", ["--check", "tools/fosu-publisher/publish.js"]),
    run("cloudbase live-smoke syntax", "node", ["--check", "tools/cloudbase/live-smoke.js"]),
    run("publisher receipt service syntax", "node", ["--check", "server/src/services/publisherReceiptService.js"]),
    run("ai provider store syntax", "node", ["--check", "server/src/services/ai/providerRuntimeConfigStore.js"]),
    run("admin route syntax", "node", ["--check", "server/src/routes/admin.js"]),
  ];
}

function localProductionTests() {
  return [
    run("windows process runner", "node", ["tools/test-process-runner.js"]),
    run("publisher launcher", "node", ["tools/test-publisher-launcher.js"]),
    run("publisher hardening", "node", ["tools/test-publisher-hardening.js"]),
    run("large staging finalize worker", "node", ["tools/test-large-staging-finalize-worker.js"]),
    run("gitattributes eol", "node", ["tools/test-gitattributes-eol.js"]),
    run("publisher token setup contract", "node", ["tools/test-publisher-token-setup-contract.js"]),
    run("publisher token verify contract", "node", ["tools/test-publisher-token-verify-contract.js"]),
    run("publisher token redaction", "node", ["tools/test-publisher-token-redaction.js"]),
    run("release check no production token in CI", "node", ["tools/test-release-check-no-production-token-in-ci.js"]),
    run("deploy requires admin api token", "node", ["tools/test-deploy-requires-admin-api-token.js"]),
    run("admin UTF-8", "node", ["tools/test-admin-utf8.js"]),
    run("AI public safety", "node", ["tools/test-public-ai-safety.js"]),
    run("AI input and voice", "node", ["tools/test-ai-assistant-input-and-voice.js"]),
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

function publisherTokenGate() {
  const token = getPublisherAdminToken({ allowOracleAlias: false });
  return {
    label: "publisher ADMIN_API_TOKEN",
    ok: Boolean(token.token),
    source: token.source || "",
    terminalRefreshRecommended: Boolean(token.terminalRefreshRecommended),
    message: token.token
      ? "ADMIN_API_TOKEN is configured for local publisher use."
      : "ADMIN_API_TOKEN is not available for live publisher checks.",
  };
}

function experience() {
  const cloudbaseRuntimeConfig = readCloudbaseConfig();
  const tokenGate = publisherTokenGate();
  const ci = isCiEnvironment();
  const externalBlocked = ci && !tokenGate.ok;
  const tokenEnv = tokenGate.ok ? { ADMIN_API_TOKEN: getPublisherAdminToken({ allowOracleAlias: false }).token } : {};
  const checks = []
    .concat(syntaxChecks())
    .concat([
      run("publisher integration", "node", ["tools/test-fosu-publisher.js"]),
      run("cloudbase static origin", "node", ["tools/test-cloudbase-static-origin.js"]),
      run("cloudbase live smoke contract", "node", ["tools/test-cloudbase-live-smoke.js"]),
      run("miniprogram build metadata", "node", ["tools/generate-miniprogram-build-info.js", "--dry-run"]),
      run("admin UTF-8", "node", ["tools/test-admin-utf8.js"]),
      run("publisher launcher self-test", "cmd.exe", ["/d", "/s", "/c", "call", "佛课小表一键同步.cmd", "--self-test", "--noninteractive"], { timeoutMs: 120000 }),
      run("miniprogram compile preflight", "node", ["tools/test-miniprogram-compile-preflight.js"]),
      configCheck("CloudBase Hosting ready", cloudbaseRuntimeConfig.CLOUDBASE_HOSTING_READY === true, cloudbaseRuntimeConfig),
      voiceGateCheck(false),
      run("git diff whitespace", "git", ["diff", "--check"]),
      secretScan(),
    ]);
  const blockers = [];
  const warnings = [];
  checks.push(configCheck("publisher ADMIN_API_TOKEN", tokenGate.ok || externalBlocked, {
    source: tokenGate.source,
    externalBlocked,
    message: tokenGate.message,
  }));
  if (tokenGate.ok) {
    checks.push(run("authenticated Oracle-only smoke", "node", ["tools/cloudbase/live-smoke.js", "--oracle-only"], {
      timeoutMs: 120000,
      env: tokenEnv,
    }));
    checks.push(run("dual-source live smoke", "npm", ["run", "cloudbase:live-smoke"], {
      timeoutMs: 180000,
      env: tokenEnv,
    }));
  } else {
    checks.push(configCheck("authenticated Oracle-only smoke", externalBlocked, {
      skipped: true,
      reason: externalBlocked ? "external-blocked" : "ADMIN_API_TOKEN missing",
    }));
    checks.push(configCheck("dual-source live smoke", externalBlocked, {
      skipped: true,
      reason: externalBlocked ? "external-blocked" : "ADMIN_API_TOKEN missing",
    }));
  }
  const runtimeMode = String(process.env.AI_RUNTIME_MODE || "public").toLowerCase();
  checks.push({ label: "public runtime mode", ok: runtimeMode !== "competition", runtimeMode });
  if (runtimeMode === "competition") blockers.push("AI_RUNTIME_MODE is competition; experience/formal release requires public.");
  const active = activeReleaseReadable();
  checks.push({
    label: "local active release pointer optional",
    ok: true,
    active,
    warning: active.ok ? "" : active.reason,
  });
  if (!tokenGate.ok && !ci) blockers.push("ADMIN_API_TOKEN is not available for live server checks.");
  if (tokenGate.terminalRefreshRecommended) warnings.push("请关闭并重新打开 PowerShell，或设置当前进程环境变量。");
  if (!configuredCloudbaseStaticBase(cloudbaseRuntimeConfig)) blockers.push("CloudBase static hosting base URL is not configured for live dual-source check.");
  if (cloudbaseRuntimeConfig.CLOUDBASE_HOSTING_READY !== true) blockers.push("CLOUDBASE_HOSTING_READY=true is required for experience release.");
  return { mode: "experience", checks, blockers, warnings, externalBlocked };
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
  const cloudbaseRuntimeConfig = readCloudbaseConfig();
  result.checks.push(configCheck("formal public AI config", cloudbaseRuntimeConfig.AI_COMPETITION_MODE !== true, {
    AI_COMPETITION_MODE: cloudbaseRuntimeConfig.AI_COMPETITION_MODE,
    message: "Formal release must not enable competition mode.",
  }));
  result.checks.push(voiceGateCheck(true));
  if (cloudbaseRuntimeConfig.AI_COMPETITION_MODE === true) {
    blockers.push("Formal release must not enable AI_COMPETITION_MODE.");
  }
  const personalSyncWxml = path.join(ROOT, "miniprogram", "pages", "personal-sync", "personal-sync.wxml");
  const appJsonPath = path.join(ROOT, "miniprogram", "app.json");
  let hasWechatPrivacyEntry = false;
  try {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    const personalSync = fs.existsSync(personalSyncWxml) ? fs.readFileSync(personalSyncWxml, "utf8") : "";
    hasWechatPrivacyEntry = appJson.__usePrivacyCheck__ === true &&
      personalSync.includes("openStudentPrivacyContract") &&
      personalSync.includes("隐私保护指引");
  } catch (_) {}
  if (!hasWechatPrivacyEntry &&
      !fs.existsSync(path.join(ROOT, "miniprogram", "privacy.json")) &&
      !fs.existsSync(path.join(ROOT, "docs", "privacy.md")) &&
      !fs.existsSync(path.join(ROOT, "miniprogram", "pages", "settings", "settings.wxml"))) {
    blockers.push("Privacy document entry was not found.");
  }
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
    warnings: result.warnings || [],
    externalBlocked: Boolean(result.externalBlocked),
    canUploadExperience: result.canUploadExperience,
    canSubmitFormal: result.canSubmitFormal,
  }, null, 2));
  if (result.mode === "experience") console.log(`canUploadExperience=${ok ? "true" : "false"}`);
  if (result.mode === "formal") console.log(`canSubmitFormal=${ok ? "true" : "false"}`);
  return ok;
}

if (require.main === module) {
  const mode = String(process.argv[2] || "preflight").replace(/^--mode=/, "");
  const result = mode === "experience"
    ? experience()
    : mode === "formal"
      ? formal()
      : preflight();
  const ok = summarize(result);
  process.exit(ok ? 0 : 1);
}

module.exports = {
  experience,
  formal,
  preflight,
  publisherTokenGate,
  summarize,
};
