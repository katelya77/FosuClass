const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  compareVersion,
  deepMerge,
  getMiniProgramBuildConfig,
} = require("./cloudbase/preflight");

const tempRoot = path.join(os.tmpdir(), `fosu-preflight-config-${process.pid}-${Date.now()}`);
const originalCwd = process.cwd();

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function cleanup() {
  process.chdir(originalCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run() {
  assert(compareVersion("3.16.1", "3.15.1") > 0);
  assert(compareVersion("3.15.1", "3.15.1") === 0);
  assert(compareVersion("2.20.1", "3.15.1") < 0);

  const merged = deepMerge(
    { libVersion: "2.20.1", setting: { urlCheck: true, minified: true }, condition: { search: { list: [1] } } },
    { libVersion: "3.16.1", setting: { urlCheck: false } }
  );
  assert.strictEqual(merged.libVersion, "3.16.1");
  assert.strictEqual(merged.setting.urlCheck, false);
  assert.strictEqual(merged.setting.minified, true);
  assert.deepStrictEqual(merged.condition.search.list, [1]);

  fs.mkdirSync(tempRoot, { recursive: true });
  writeJson(path.join(tempRoot, "project.config.json"), {
    appid: "wx-test",
    miniprogramRoot: "miniprogram/",
    compileType: "miniprogram",
    libVersion: "2.20.1",
    setting: { urlCheck: true, uploadWithSourceMap: true },
  });
  writeJson(path.join(tempRoot, "project.private.config.json"), {
    libVersion: "3.16.1",
    setting: { urlCheck: false },
  });
  process.chdir(tempRoot);
  const config = getMiniProgramBuildConfig();
  assert.strictEqual(config.baseConfig.libVersion, "2.20.1");
  assert.strictEqual(config.privateOverrides.libVersion, "3.16.1");
  assert.strictEqual(config.effectiveConfig.libVersion, "3.16.1");
  assert.strictEqual(config.libVersion, "3.16.1");
  assert.strictEqual(config.urlCheck, false);
  assert.strictEqual(config.uploadWithSourceMap, true);

  cleanup();
  console.log("test-cloudbase-preflight-config passed");
}

try {
  run();
} catch (error) {
  try { cleanup(); } catch (cleanupError) {}
  console.error(error);
  process.exit(1);
}
