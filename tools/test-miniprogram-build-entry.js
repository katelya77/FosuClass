const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf-8"));

assert.strictEqual(projectConfig.miniprogramRoot, "miniprogram/", "project.config.json miniprogramRoot must point to source miniprogram/");
assert.strictEqual(projectConfig.srcMiniprogramRoot, "miniprogram/", "srcMiniprogramRoot must match miniprogramRoot");
assert.strictEqual(projectConfig.compileType, "miniprogram", "compileType must remain miniprogram");

[
  path.join(root, "output", "miniprogram"),
  path.join(root, "dist", "miniprogram"),
].forEach((candidate) => {
  assert(!fs.existsSync(candidate), `${path.relative(root, candidate)} should not exist as an alternate runnable miniprogram root`);
});

const buildInfo = require("../miniprogram/config/buildInfo");
assert(/^security-transport-v\d+/.test(buildInfo.REQUEST_PIPELINE_VERSION), "request pipeline version should be explicit");
assert(buildInfo.CLIENT_BUILD_ID.includes(buildInfo.GIT_COMMIT_SHORT_SHA), "client build id should include git short SHA");
assert(buildInfo.CLIENT_BUILD_ID.includes(buildInfo.REQUEST_PIPELINE_VERSION), "client build id should include pipeline version");

console.log("test-miniprogram-build-entry passed");
