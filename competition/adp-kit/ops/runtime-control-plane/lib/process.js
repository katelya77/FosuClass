"use strict";

const { spawnSync } = require("node:child_process");

function commandExists(command) {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(probe, [command], { encoding: "utf8", windowsHide: true }).status === 0;
}

function resolveCommand(command) {
  if (process.platform !== "win32") return command;
  const path = require("node:path");
  if (path.isAbsolute(command)) return command;
  const found = spawnSync("where.exe", [command], { encoding: "utf8", windowsHide: true });
  if (found.status !== 0) return command;
  const matches = found.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return matches.find((x) => /\.(?:exe|cmd|bat)$/i.test(x)) || matches[0] || command;
}

function run(command, args, options = {}) {
  const resolved = resolveCommand(command);
  let executable = resolved;
  let spawnArgs = args;
  if (process.platform === "win32" && /\\tcb\.cmd$/i.test(resolved)) {
    executable = process.execPath;
    spawnArgs = [pathForNpmShim(resolved, "@cloudbase", "cli", "bin", "tcb"), ...args];
  } else if (process.platform === "win32" && /\\npm\.cmd$/i.test(resolved)) {
    executable = process.execPath;
    spawnArgs = [pathForNpmShim(resolved, "npm", "bin", "npm-cli.js"), ...args];
  }
  const result = spawnSync(executable, spawnArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
    env: options.env || process.env,
    stdio: options.stdio || "pipe",
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", error: result.error };
}

function pathForNpmShim(shim, ...parts) {
  const path = require("node:path");
  return path.join(path.dirname(shim), "node_modules", ...parts);
}

module.exports = { commandExists, resolveCommand, run };
