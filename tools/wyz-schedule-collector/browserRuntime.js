"use strict";
const fs = require("fs"), path = require("path");
function rejected(code) { return Object.assign(new Error(code), { code }); }
function runtime(root) {
  const file = path.join(root, "browser-runtime.json");
  if (!fs.existsSync(file)) return { mode: "native" };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.uid !== 0 || (stat.mode & 0o077)))) throw rejected("BROWSER_RUNTIME_PERMISSIONS_REJECTED");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.mode === "native") return value;
  if (value.mode !== "container" || !["podman", "docker"].includes(value.engine) || !/^sha256:[a-f0-9]{64}$/.test(value.image || "")) throw rejected("BROWSER_RUNTIME_REJECTED");
  return value;
}
function workerCommand(executable, args, env, cfg, dir, root) {
  const selected = runtime(cfg.dataRoot);
  if (selected.mode === "native") return { executable, args, cwd: root, env };
  for (const file of [cfg.sessionPath, dir, path.join(cfg.dataRoot, "catalog")]) {
    if (!path.isAbsolute(file) || file.includes(",") || fs.lstatSync(file).isSymbolicLink()) throw rejected("CONTAINER_MOUNT_REJECTED");
  }
  // Only the lease, this run and validated catalog enter the worker. No Oracle,
  // personal-Agent or CloudBase credentials and no Docker socket are mounted.
  const containerArgs = ["run", "--rm", "--init", "--name", "fosu-collector-worker", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--cpus=1", "--memory=768m", "--pids-limit=256", "--shm-size=256m", "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m", "--workdir", "/collector"];
  for (const [source, readonly] of [[cfg.sessionPath, true], [dir, false], [path.join(cfg.dataRoot, "catalog"), false]]) containerArgs.push("--mount", "type=bind,src=" + source + ",dst=" + source + (readonly ? ",readonly" : ""));
  const childEnv = Object.assign({}, env);
  delete childEnv.PLAYWRIGHT_BROWSERS_PATH;
  delete childEnv.NODE_PATH;
  for (const key of Object.keys(childEnv)) if (!/^(PATH|Path|HOME|USERPROFILE|SystemRoot|TEMP|TMP)$/.test(key)) containerArgs.push("--env", key);
  containerArgs.push(selected.image, "node", ...args);
  return { executable: "/usr/bin/" + selected.engine, args: containerArgs, cwd: root, env: childEnv };
}
async function launch(chromium, args = []) {
  try { return await chromium.launch({ headless: true, args, timeout: 30000 }); }
  catch (_) { throw rejected("PLAYWRIGHT_LAUNCH_FAILED"); }
}
module.exports = { launch, runtime, workerCommand };
