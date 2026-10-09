"use strict";
const fs = require("fs"), { spawn } = require("child_process");
function leaseAlive(file, now = Date.now()) {
  try { const value = JSON.parse(fs.readFileSync(file, "utf8")); return Number.isSafeInteger(value.deadline) && value.deadline > now && value.deadline <= now + 90000; }
  catch (_) { return false; }
}
function run(args, env = process.env) {
  if (!leaseAlive(env.FOSU_COLLECTOR_WATCHDOG_FILE)) return Promise.resolve(65);
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { env, stdio: "ignore" });
    let expired = false, killTimer;
    function stop() {
      expired = true; child.kill("SIGTERM");
      if (!killTimer) killTimer = setTimeout(() => child.kill("SIGKILL"), 30000);
    }
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
    const timer = setInterval(() => { if (!leaseAlive(env.FOSU_COLLECTOR_WATCHDOG_FILE)) stop(); }, 5000);
    function finish(code) { clearInterval(timer); clearTimeout(killTimer); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); resolve(expired ? 65 : code); }
    child.once("error", () => finish(66));
    child.once("exit", code => finish(code === null ? 65 : code));
  });
}
if (require.main === module) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
module.exports = { leaseAlive, run };
