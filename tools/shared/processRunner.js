const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_TAIL_CHARS = 4000;
const SENSITIVE_ARG_PATTERN = /token|ticket|cookie|secret|authorization|password|passwd|pwd|api[-_]?key|session/i;

function isWindows(platform) {
  return String(platform || process.platform) === "win32";
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function tailText(text, maxChars = DEFAULT_TAIL_CHARS) {
  const value = stripAnsi(text);
  const limit = Math.max(200, Number(maxChars || DEFAULT_TAIL_CHARS) || DEFAULT_TAIL_CHARS);
  return value.length > limit ? value.slice(-limit) : value;
}

function redactArg(value, previousArg) {
  const text = String(value == null ? "" : value);
  const previous = String(previousArg || "");
  if (SENSITIVE_ARG_PATTERN.test(previous) && /^--?[^=\s]+$/i.test(previous)) return "[redacted]";
  if (/^--?[^=\s]*(token|ticket|cookie|secret|authorization|password|passwd|pwd|api[-_]?key|session)[^=\s]*=/i.test(text)) {
    return text.replace(/=.*/s, "=[redacted]");
  }
  if (/(^|[\\/])\.session([\\/]|$)|session\.json/i.test(text)) {
    return "[redacted-session-path]";
  }
  if (/(Bearer\s+)[A-Za-z0-9._~+/=-]+/i.test(text)) {
    return text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]");
  }
  return text;
}

function redactArgs(args = []) {
  return (args || []).map((arg, index) => redactArg(arg, index > 0 ? args[index - 1] : ""));
}

function quoteCmdArg(value) {
  const text = String(value == null ? "" : value);
  if (text === "") return "\"\"";
  if (/^[a-zA-Z0-9_./\\:=@+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"").replace(/%/g, "^%")}"`;
}

function fileExists(filePath, deps = {}) {
  const fsImpl = deps.fs || fs;
  try {
    return Boolean(filePath && fsImpl.existsSync(filePath) && fsImpl.statSync(filePath).isFile());
  } catch (error) {
    return false;
  }
}

function isJavaScriptCli(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return ext === ".js" || ext === ".cjs" || ext === ".mjs";
}

function isNodeCommand(command) {
  const base = path.basename(String(command || "")).toLowerCase();
  return base === "node" || base === "node.exe";
}

function isNpmCommand(command) {
  const base = path.basename(String(command || "")).toLowerCase();
  return base === "npm" || base === "npm.cmd" || base === "npm-cli.js";
}

function resolveCommand(command, args = [], options = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  const env = Object.assign({}, process.env, options.env || {});
  const execPath = deps.execPath || process.execPath;
  const rawCommand = String(command || "");
  const rawArgs = Array.isArray(args) ? args.map(String) : [];

  if (isNodeCommand(rawCommand)) {
    return {
      command: "node",
      file: execPath,
      args: rawArgs,
      invocation: "process.execPath",
      shell: false,
      safeArgs: redactArgs(rawArgs),
    };
  }

  if (isNpmCommand(rawCommand)) {
    const npmExecPath = String(env.npm_execpath || "").trim();
    if (npmExecPath && fileExists(npmExecPath, deps) && isJavaScriptCli(npmExecPath)) {
      return {
        command: "npm",
        file: execPath,
        args: [npmExecPath].concat(rawArgs),
        invocation: "npm_execpath",
        shell: false,
        safeArgs: redactArgs([npmExecPath].concat(rawArgs)),
      };
    }

    if (isWindows(platform)) {
      const npmCommand = rawCommand.toLowerCase().endsWith(".cmd") ? rawCommand : "npm.cmd";
      const commandLine = ["call", quoteCmdArg(npmCommand)].concat(rawArgs.map(quoteCmdArg)).join(" ");
      return {
        command: "npm",
        file: env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", commandLine],
        invocation: "cmd-call-npm.cmd",
        shell: false,
        safeArgs: ["/d", "/s", "/c", ["call", quoteCmdArg(npmCommand)].concat(redactArgs(rawArgs).map(quoteCmdArg)).join(" ")],
      };
    }

    return {
      command: "npm",
      file: "npm",
      args: rawArgs,
      invocation: "path-npm",
      shell: false,
      safeArgs: redactArgs(rawArgs),
    };
  }

  return {
    command: rawCommand,
    file: rawCommand,
    args: rawArgs,
    invocation: "direct",
    shell: false,
    safeArgs: redactArgs(rawArgs),
  };
}

function normalizeSpawnError(error) {
  if (!error) return null;
  return {
    code: error.code || "UNKNOWN",
    errno: error.errno,
    syscall: error.syscall || "",
    path: error.path || "",
    message: error.message || String(error),
  };
}

function classifyProcessFailure(result) {
  const spawnCode = result.error && result.error.code || "";
  if (spawnCode === "ETIMEDOUT") return "CHILD_PROCESS_TIMEOUT";
  if (spawnCode === "ENOENT") return "CHILD_PROCESS_SPAWN_FAILED";
  if (spawnCode === "EINVAL") return "CHILD_PROCESS_SPAWN_FAILED";
  if (spawnCode === "EPERM") return "CHILD_PROCESS_SPAWN_FAILED";
  if (spawnCode === "ENOBUFS" || /maxBuffer/i.test(String(result.error && result.error.message || ""))) return "CHILD_PROCESS_MAX_BUFFER";
  if (spawnCode) return spawnCode;
  if (result.signal) return `SIGNAL_${result.signal}`;
  if (result.status === null || result.status === undefined) return "CHILD_PROCESS_EXIT_UNKNOWN";
  return `EXIT_${result.status}`;
}

function runProcess(command, args = [], options = {}, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const plan = resolveCommand(command, args, options, deps);
  const startedAt = Date.now();
  const cwd = options.cwd || process.cwd();
  const stdio = options.inherit === true ? "inherit" : (options.stdio || "pipe");
  const result = spawn(plan.file, plan.args, {
    cwd,
    env: Object.assign({}, process.env, options.env || {}),
    encoding: options.encoding || "utf8",
    stdio,
    timeout: options.timeoutMs || 0,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    shell: false,
  }) || {};
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const spawnError = normalizeSpawnError(result.error);
  const status = result.status === undefined ? null : result.status;
  const ok = !spawnError && status === 0;
  const output = {
    ok,
    command: plan.command,
    executable: plan.file,
    args: plan.args,
    safeArgs: plan.safeArgs,
    invocation: plan.invocation,
    cwd,
    status,
    signal: result.signal || null,
    error: spawnError,
    stdout,
    stderr,
    stdoutTail: tailText(stdout, options.tailChars),
    stderrTail: tailText(stderr, options.tailChars),
    failureCode: null,
    elapsedMs: Date.now() - startedAt,
  };
  output.failureCode = ok ? null : classifyProcessFailure(output);
  return output;
}

function formatFailure(result, options = {}) {
  const code = classifyProcessFailure(result);
  const diagnostics = {
    command: result.command,
    executable: result.executable,
    safeArgs: result.safeArgs,
    invocation: result.invocation,
    cwd: result.cwd,
    status: result.status,
    signal: result.signal,
    processFailureCode: code,
    spawnErrorCode: result.error && result.error.code || "",
    spawnErrorMessage: result.error && result.error.message || "",
    stderrTail: result.stderrTail,
    stdoutTail: result.stdoutTail,
  };
  return {
    code,
    diagnostics,
    message: [
      `${result.command} ${result.safeArgs.join(" ")} failed`,
      `status=${result.status === null ? "null" : result.status}`,
      `spawn=${code}`,
      result.error && result.error.message ? result.error.message : "",
      options.includeOutput === false ? "" : result.stderrTail,
    ].filter(Boolean).join("; "),
  };
}

function runCommand(command, args = [], options = {}, deps = {}) {
  const result = runProcess(command, args, options, deps);
  if (result.ok) return result;
  const failure = formatFailure(result, options);
  const error = new Error(failure.message);
  error.code = options.code || failure.code || "COMMAND_FAILED";
  error.processFailureCode = failure.code;
  error.status = result.status;
  error.signal = result.signal;
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  error.originalError = result.error;
  error.diagnostics = failure.diagnostics;
  throw error;
}

module.exports = {
  formatFailure,
  quoteCmdArg,
  redactArg,
  redactArgs,
  resolveCommand,
  runCommand,
  runProcess,
  tailText,
};
