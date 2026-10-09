"use strict";
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const names = fs.readdirSync(__dirname).filter(name => /^test-(campus-agent-|campus-sync-|personal-sync-|wyz-campus-agent-).*\.js$/.test(name)).sort();
for (const name of names) {
  const result = spawnSync(process.execPath, ["tools/" + name], { stdio: "inherit", windowsHide: true, timeout: 180000, env: { ...process.env, ADMIN_API_TOKEN: "collector-regression-fixture", NODE_OPTIONS: [process.env.NODE_OPTIONS, "--require=" + path.join(__dirname, "fixture-network-only.js")].filter(Boolean).join(" ") } });
  if (result.status !== 0) { console.error("FAILED:" + name); process.exit(result.status || 1); }
}
console.log("collector-personal-regression: " + names.length + " suites PASS; external network blocked");
