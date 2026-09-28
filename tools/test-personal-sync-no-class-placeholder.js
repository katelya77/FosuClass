const assert = require("assert");
const { buildPersonalSyncSubtitle } = require("../miniprogram/services/personalSyncSurface");
const index = require("fs").readFileSync(require("path").join(__dirname, "../miniprogram/pages/index/index.js"), "utf8");

assert.strictEqual(buildPersonalSyncSubtitle("", "2026-2027-1"), "2026-2027-1 · 学号同步");
assert.strictEqual(buildPersonalSyncSubtitle("班级未确认", "2026-2027-1"), "2026-2027-1 · 学号同步");
assert.strictEqual(buildPersonalSyncSubtitle("25动物医学6班", "2026-2027-1"), "25动物医学6班 · 2026-2027-1 · 学号同步");
assert.ok(index.includes("学号同步"));
assert.ok(!index.includes("|| \"班级未确认\""));
console.log("personal sync no class placeholder ok");
