const assert = require("assert");
const { makeBuildInfo, renderBuildInfo } = require("./generate-miniprogram-build-info");

const info = makeBuildInfo({
  pipelineVersion: "security-transport-v9",
  gitCommitShortSha: "abcdef1",
  buildTimestamp: "2026-06-07T12:34:56.789Z",
});

assert.strictEqual(info.REQUEST_PIPELINE_VERSION, "security-transport-v9");
assert.strictEqual(info.GIT_COMMIT_SHORT_SHA, "abcdef1");
assert.strictEqual(info.BUILD_TIMESTAMP, "2026-06-07T12:34:56.789Z");
assert.strictEqual(info.CLIENT_BUILD_ID, "security-transport-v9-abcdef1-20260607123456");

const rendered = renderBuildInfo(info);
assert(rendered.includes("security-transport-v9"));
assert(rendered.includes("abcdef1"));
assert(rendered.includes("module.exports"));
assert(!/token|secret|password/i.test(rendered), "build info must not contain secret-like fields");

console.log("test-generate-miniprogram-build-info passed");
