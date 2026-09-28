const { spawnSync } = require("child_process");
const path = require("path");

const result = spawnSync(process.execPath, [path.join(__dirname, "run-admin-campus-sync-browser-acceptance.js")], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status || 1);
console.log("campus-sync-maintenance-ui PASS");
