const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminCampusSyncAssets.js"), "utf8");
assert.ok(source.includes("cs.inflight[key]"));
assert.ok(source.includes("trendGeneration"));
assert.ok(source.includes("signal: cs.control && cs.control.signal"));
assert.ok(!source.includes("Promise.all(["));
assert.ok(source.includes("csLoadCritical"));
assert.ok(source.includes("10000"));
assert.ok(source.includes("60000"));
assert.ok(source.includes("300000"));
console.log("campus-sync-admin-singleflight PASS");
