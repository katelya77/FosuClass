#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertSafeCmdValue,
  isWechatUploadIpError,
  mergeNoProxy,
  prepareWechatDirectNetworkEnvironment,
  resolveWechatDevtoolsCli,
  withEphemeralBuildInfo,
} = require("./upload-wechat-trial");

const env = {
  HTTP_PROXY: "http://127.0.0.1:10808",
  HTTPS_PROXY: "http://127.0.0.1:10808",
  ALL_PROXY: "socks5://127.0.0.1:10808",
  NO_PROXY: "100.fosu.edu.cn,localhost",
};

const result = prepareWechatDirectNetworkEnvironment(env);
assert.strictEqual(result.proxyDisabled, true);
assert.strictEqual(env.HTTP_PROXY, undefined);
assert.strictEqual(env.HTTPS_PROXY, undefined);
assert.strictEqual(env.ALL_PROXY, undefined);
assert.match(env.NO_PROXY, /(?:^|,)servicewechat\.com(?:,|$)/);
assert.match(env.NO_PROXY, /(?:^|,)\.servicewechat\.com(?:,|$)/);
assert.strictEqual(env.no_proxy, env.NO_PROXY);
assert.strictEqual(
  mergeNoProxy("servicewechat.com,.servicewechat.com"),
  "servicewechat.com,.servicewechat.com",
  "direct-host allowlist must be idempotent",
);
assert.strictEqual(isWechatUploadIpError(new Error('{"errCode":-10008,"errMsg":"invalid ip"}')), true);
assert.strictEqual(isWechatUploadIpError(new Error("network timeout")), false);
assert.strictEqual(resolveWechatDevtoolsCli({ WECHAT_DEVTOOLS_CLI: __filename }), __filename);
assert.strictEqual(assertSafeCmdValue("safe trial 2026-2027-1; no formal review", "description").includes("safe trial"), true);
assert.throws(() => assertSafeCmdValue("unsafe & publish", "description"), /unsupported command characters/);

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-wechat-build-info-"));
  const target = path.join(tempDir, "buildInfo.js");
  fs.writeFileSync(target, "original\n", "utf8");
  let during = "";
  await withEphemeralBuildInfo(async (info) => {
    during = fs.readFileSync(target, "utf8");
    assert.match(during, /abcdef1/);
    assert.strictEqual(info.GIT_COMMIT_SHORT_SHA, "abcdef1");
  }, {
    target,
    buildInfo: {
      gitCommitShortSha: "abcdef1",
      buildTimestamp: "2026-08-13T00:00:00.000Z",
    },
  });
  assert.strictEqual(fs.readFileSync(target, "utf8"), "original\n", "upload metadata must not dirty the worktree");
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("wechat upload direct-network isolation PASS");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
