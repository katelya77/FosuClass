const assert = require("assert");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const runtimeDataDir = path.join(os.tmpdir(), "fosu-runtime-path-contract");
const script = [
  "const path = require('path');",
  "const kb = require('./server/src/services/ai/knowledgeBaseService');",
  "const mapVersion = require('./server/src/services/ai/campusMapVersionService');",
  "const map = require('./server/src/services/ai/campusMapService');",
  "process.stdout.write(JSON.stringify({kb:kb.DATA_PATH,mapVersion:mapVersion.LEGACY_DATA_PATH,map:map.DATA_PATH}));",
].join("");

const result = spawnSync(process.execPath, ["-e", script], {
  cwd: path.resolve(__dirname, ".."),
  env: { ...process.env, FOSU_DATA_DIR: runtimeDataDir, FOSU_ASSISTANT_KB_PATH: "" },
  encoding: "utf8",
});

assert.strictEqual(result.status, 0, result.stderr);
const paths = JSON.parse(result.stdout);
const expectedKb = path.resolve(runtimeDataDir, "ai", "knowledge-docs.json");
const expectedMap = path.resolve(runtimeDataDir, "ai", "campus-places.json");
assert.strictEqual(paths.kb, expectedKb, "knowledge base default must live in mounted runtime data");
assert.strictEqual(paths.mapVersion, expectedMap, "campus map legacy mirror must live in mounted runtime data");
assert.strictEqual(paths.map, expectedMap, "campus map readers and writers must share the same durable mirror");

console.log(JSON.stringify({ ok: true, paths }, null, 2));
