#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { runProcess } = require("../shared/processRunner");

const cloudbaseConfig = require("../../miniprogram/config/cloudbase");
const buildInfo = require("../../miniprogram/config/buildInfo");
const {
  ENV_ID,
  parseArgs,
} = require("./release-pack-utils");
const {
  extractActiveRelease,
  fetchOracleActivePointer,
} = require("./oracle-release-source");

function stripAnsi(text) {
  return String(text || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function truncateText(text, maxChars) {
  const value = String(text || "");
  const limit = Number(maxChars || 12000);
  if (!limit || value.length <= limit) {
    return { text: value, truncated: false, originalLength: value.length };
  }
  return {
    text: `${value.slice(0, limit)}\n... [truncated ${value.length - limit} chars]`,
    truncated: true,
    originalLength: value.length,
  };
}

function commandName(name) {
  if (name === "tcb" && process.platform === "win32") return "tcb.cmd";
  if (name === "npm" && process.platform === "win32") return "npm.cmd";
  return name;
}

function quoteWinArg(value) {
  const text = String(value || "");
  if (/^[a-zA-Z0-9_./\\:=@+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function runCommand(command, args = [], options = {}) {
  if (command === "npm" || command === "node") {
    const result = runProcess(command, args, {
      cwd: options.cwd || process.cwd(),
      timeoutMs: options.timeoutMs || 120000,
      maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
      tailChars: options.maxOutputChars || 12000,
    });
    const stdout = truncateText(stripAnsi(result.stdout || result.stdoutTail || ""), options.maxOutputChars);
    const stderr = truncateText(stripAnsi(result.stderr || result.stderrTail || ""), options.maxOutputChars);
    return {
      command: [command].concat(result.safeArgs || args).join(" "),
      status: result.status,
      ok: result.ok,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      stdoutOriginalLength: stdout.originalLength,
      stderrOriginalLength: stderr.originalLength,
      elapsedMs: result.elapsedMs,
      error: result.error ? result.error.message : "",
    };
  }
  const startedAt = Date.now();
  const resolvedCommand = commandName(command);
  const isWindowsCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCommand);
  const spawnCommand = isWindowsCmd ? "cmd.exe" : resolvedCommand;
  const spawnArgs = isWindowsCmd
    ? ["/d", "/s", "/c", [resolvedCommand].concat(args).map(quoteWinArg).join(" ")]
    : args;
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: options.timeoutMs || 120000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
  });
  const stdout = truncateText(stripAnsi(result.stdout || ""), options.maxOutputChars);
  const stderr = truncateText(stripAnsi(result.stderr || ""), options.maxOutputChars);
  return {
    command: [command].concat(args).join(" "),
    status: result.status,
    ok: result.status === 0,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    stdoutOriginalLength: stdout.originalLength,
    stderrOriginalLength: stderr.originalLength,
    elapsedMs: Date.now() - startedAt,
    error: result.error ? result.error.message : "",
  };
}

function parseHostingDomain(detailText) {
  const text = stripAnsi(detailText);
  const match = text.match(/Domain:\s*(https?:\/\/\S+)/i) || text.match(/(https:\/\/[a-z0-9.-]+tcloudbaseapp\.com)/i);
  return match ? match[1].replace(/[)\],.]+$/g, "") : "";
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, overrides) {
  const result = Object.assign({}, base || {});
  Object.keys(overrides || {}).forEach((key) => {
    if (isPlainObject(result[key]) && isPlainObject(overrides[key])) {
      result[key] = deepMerge(result[key], overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  });
  return result;
}

function compareVersion(left, right) {
  const a = String(left || "0").split(".").map((item) => Number(item) || 0);
  const b = String(right || "0").split(".").map((item) => Number(item) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getDiskInfo(targetDir) {
  try {
    if (typeof fs.statfsSync === "function") {
      const stat = fs.statfsSync(targetDir);
      return {
        path: targetDir,
        availableBytes: Number(stat.bavail || 0) * Number(stat.bsize || 0),
        totalBytes: Number(stat.blocks || 0) * Number(stat.bsize || 0),
      };
    }
  } catch (error) {
    return { path: targetDir, error: error.message };
  }
  return { path: targetDir, availableBytes: 0, totalBytes: 0, unsupported: true };
}

function getMiniProgramBuildConfig() {
  const baseConfig = readJsonSafe(path.resolve("project.config.json")) || {};
  const privateOverrides = readJsonSafe(path.resolve("project.private.config.json")) || {};
  const effectiveConfig = deepMerge(baseConfig, privateOverrides);
  return {
    baseConfig,
    privateOverrides,
    effectiveConfig,
    appid: effectiveConfig.appid || "",
    miniprogramRoot: effectiveConfig.miniprogramRoot || "",
    cloudfunctionRoot: effectiveConfig.cloudfunctionRoot || "",
    compileType: effectiveConfig.compileType || "",
    libVersion: effectiveConfig.libVersion || "",
    urlCheck: effectiveConfig.setting && effectiveConfig.setting.urlCheck,
    uploadWithSourceMap: effectiveConfig.setting && effectiveConfig.setting.uploadWithSourceMap,
    buildInfo,
  };
}

async function runPreflight(options = {}) {
  const envId = options.envId || ENV_ID;
  const root = process.cwd();
  const commands = {};
  commands.nodeVersion = runCommand("node", ["-v"], { timeoutMs: 30000 });
  commands.npmVersion = runCommand("npm", ["-v"], { timeoutMs: 30000 });
  commands.tcbVersion = runCommand("tcb", ["-v"], { timeoutMs: 30000 });
  commands.whereTcb = process.platform === "win32"
    ? runCommand("where.exe", ["tcb"], { timeoutMs: 30000 })
    : runCommand("which", ["tcb"], { timeoutMs: 30000 });

  commands.tcbLogin = runCommand("tcb", ["login"], { timeoutMs: options.loginTimeoutMs || 10 * 60 * 1000 });
  commands.envList = runCommand("tcb", ["env", "list"], { timeoutMs: 120000 });
  commands.envUse = runCommand("tcb", ["env", "use", envId], { timeoutMs: 120000 });
  commands.envUsage = runCommand("tcb", ["env", "usage", "-e", envId], { timeoutMs: 120000 });
  commands.hostingDetail = runCommand("tcb", ["hosting", "detail", "-e", envId], { timeoutMs: 120000 });
  commands.hostingList = runCommand("tcb", ["hosting", "list", "-e", envId], { timeoutMs: 120000 });
  commands.gitStatus = runCommand("git", ["status", "--short", "--branch"], { timeoutMs: 30000 });

  let oracle = null;
  try {
    const source = await fetchOracleActivePointer({ oracleBaseUrl: options.oracleBaseUrl });
    oracle = Object.assign({}, extractActiveRelease(source), {
      source: source.source,
      oracleBaseUrl: source.oracleBaseUrl,
      fallbackReason: source.fallbackReason || "",
    });
  } catch (error) {
    oracle = {
      success: false,
      code: error.code || "ORACLE_ACTIVE_READ_FAILED",
      message: error.message,
    };
  }

  const hostingDomain = parseHostingDomain(commands.hostingDetail.stdout);
  const cloudbaseAi = {
    CLOUDBASE_AI_ENABLED: cloudbaseConfig.CLOUDBASE_AI_ENABLED,
    CLOUDBASE_AI_MODEL: cloudbaseConfig.CLOUDBASE_AI_MODEL,
    CLOUDBASE_AI_PROMO_EXPIRES_AT: cloudbaseConfig.CLOUDBASE_AI_PROMO_EXPIRES_AT,
    AI_GENERATIVE_PUBLIC_ENABLED: cloudbaseConfig.AI_GENERATIVE_PUBLIC_ENABLED,
    AI_COMPETITION_MODE: cloudbaseConfig.AI_COMPETITION_MODE,
    AI_TOOL_ONLY_MODE: cloudbaseConfig.AI_TOOL_ONLY_MODE,
  };
  const hosting = {
    configuredBaseUrl: cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL,
    enabled: cloudbaseConfig.CLOUDBASE_HOSTING_ENABLED,
    ready: cloudbaseConfig.CLOUDBASE_HOSTING_READY,
    realDomain: hostingDomain,
    matchesConfig: hostingDomain ? hostingDomain === cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL : false,
  };

  const miniprogramBuild = getMiniProgramBuildConfig();
  const warnings = [];
  const errors = [];
  if (compareVersion(miniprogramBuild.libVersion, "3.15.1") < 0) {
    errors.push(`effective libVersion ${miniprogramBuild.libVersion || "(empty)"} is lower than 3.15.1`);
  }
  if (miniprogramBuild.urlCheck === false) {
    warnings.push("本地开发不会检查合法域名，必须使用体验版真机验证");
  }

  return {
    success: errors.length === 0,
    envId,
    cwd: root,
    tcbLoggedIn: commands.tcbLogin.ok,
    commands,
    hosting,
    oracle,
    disk: getDiskInfo(root),
    git: {
      status: commands.gitStatus.stdout.trim(),
      statusRecorded: commands.gitStatus.ok,
    },
    cloudbaseAi,
    miniprogramBuild,
    warnings,
    errors,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPreflight({
    envId: args["env-id"] || ENV_ID,
    oracleBaseUrl: args["oracle-base-url"] || args.oracleBaseUrl,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      success: false,
      code: error.code || "CLOUDBASE_PREFLIGHT_FAILED",
      message: error.message,
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  parseHostingDomain,
  compareVersion,
  deepMerge,
  getMiniProgramBuildConfig,
  runCommand,
  runPreflight,
};
