const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminCampusSyncAssets.js"), "utf8");
assert.ok(source.includes("policyDirty"));
assert.ok(source.includes("有未保存的修改"));
assert.ok(source.includes("放弃修改"));
assert.ok(source.includes("服务器策略已发生变化，请重新加载后再修改。"));
assert.ok(source.includes("expectedRevision: cs.serverRevision"));
assert.ok(source.includes("if (node && !cs.policyDirty && (force || document.activeElement !== node))"));
assert.ok(!source.includes("取消编辑"));
console.log("policy-dirty-form PASS");
