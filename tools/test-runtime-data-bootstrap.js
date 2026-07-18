const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { bootstrapRuntimeData } = require("../server/src/services/runtimeDataBootstrapService");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-runtime-bootstrap-"));
try {
  const seedDir = path.join(root, "seed-data");
  const dataDir = path.join(root, "runtime-data");
  writeJson(path.join(seedDir, "ai", "knowledge-docs.json"), { version: "seed-v1", docs: [{ id: "guide" }] });
  writeJson(path.join(seedDir, "ai", "campus-places.json"), { version: "map-v1", places: [{ id: "north" }] });

  const first = bootstrapRuntimeData({ seedDir, dataDir });
  assert.strictEqual(first.schemaVersion, 1);
  assert.strictEqual(first.copied.length, 2);
  assert.deepStrictEqual(first.skipped, []);
  assert.ok(first.files.every((entry) => !path.isAbsolute(entry.path)), "manifest paths must stay relative");
  assert.ok(first.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)), "seed hashes required");
  assert.ok(fs.existsSync(path.join(dataDir, ".fosu-runtime-bootstrap.json")), "bootstrap marker required");
  assert.strictEqual(hash(path.join(dataDir, "ai", "knowledge-docs.json")), hash(path.join(seedDir, "ai", "knowledge-docs.json")));

  const runtimeKnowledge = { version: "runtime-edited", docs: [{ id: "operator-change" }] };
  writeJson(path.join(dataDir, "ai", "knowledge-docs.json"), runtimeKnowledge);
  writeJson(path.join(seedDir, "ai", "knowledge-docs.json"), { version: "seed-v2", docs: [] });
  const beforeRuntimeHash = hash(path.join(dataDir, "ai", "knowledge-docs.json"));
  const second = bootstrapRuntimeData({ seedDir, dataDir });
  assert.strictEqual(second.copied.length, 0, "existing runtime files must never be overwritten");
  assert.deepStrictEqual(second.skipped.sort(), ["ai/campus-places.json", "ai/knowledge-docs.json"]);
  assert.strictEqual(hash(path.join(dataDir, "ai", "knowledge-docs.json")), beforeRuntimeHash);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "ai", "knowledge-docs.json"), "utf8")), runtimeKnowledge);

  const unsafeSeed = path.join(root, "unsafe-seed");
  fs.mkdirSync(unsafeSeed, { recursive: true });
  let linkCreated = false;
  try {
    fs.symlinkSync(path.join(seedDir, "ai"), path.join(unsafeSeed, "ai"), process.platform === "win32" ? "junction" : "dir");
    linkCreated = true;
  } catch (_) {}
  if (linkCreated) {
    assert.throws(
      () => bootstrapRuntimeData({ seedDir: unsafeSeed, dataDir: path.join(root, "unsafe-target") }),
      (error) => error && error.code === "RUNTIME_SEED_UNSAFE"
    );
  }

  const sameRoot = bootstrapRuntimeData({ seedDir: dataDir, dataDir });
  assert.strictEqual(sameRoot.copied.length, 0, "local same-root mode must be a no-op");

  const freshSameRoot = path.join(root, "fresh-same-root");
  writeJson(path.join(freshSameRoot, "ai", "knowledge-docs.json"), { version: "local-only" });
  const freshSameRootResult = bootstrapRuntimeData({ seedDir: freshSameRoot, dataDir: freshSameRoot });
  assert.strictEqual(freshSameRootResult.sameRoot, true);
  assert.strictEqual(fs.existsSync(path.join(freshSameRoot, ".fosu-runtime-bootstrap.json")), false, "same-root local mode must not mutate the source tree");

  console.log(JSON.stringify({ ok: true, copied: first.copied, skipped: second.skipped, symlinkCheck: linkCreated ? "verified" : "unsupported" }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
