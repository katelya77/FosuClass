// P4a：Config Kernel Repository 契约测试（conformance suite）。
// 同一套契约对文件适配器与未来的 PostgreSQL 适配器（P5a）分别运行：
//   const { runConfigKernelRepositoryConformance } = require("...");
//   runConfigKernelRepositoryConformance({ assert, label: "file", createRepository: () => ... });
// 每个用例在全新 repository 实例上执行（调用方负责隔离/清理）。

const { REPOSITORY_METHODS } = require("./fileRepository");

function baseVersionDoc(overrides = {}) {
  return Object.assign({
    schemaVersion: "config-artifact.v1",
    domain: "skill",
    artifactId: "conformance",
    environment: "trial",
    version: 1,
    payload: { skills: [{ id: "alpha" }] },
    origin: "admin",
    sourceDigest: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "conformance",
    digest: "",
  }, overrides);
}

function baseSnapshot(overrides = {}) {
  return Object.assign({
    schemaVersion: "config-snapshot.v1",
    configVersion: "cfg-trial-0001-abcdef123456",
    environment: "trial",
    capturedAt: "2026-01-01T00:00:00.000Z",
    artifacts: { "skill:conformance": { domain: "skill", artifactId: "conformance", version: 1, digest: "x" } },
    digest: "",
  }, overrides);
}

// digest 由调用方用与实现一致的 canonical 算法计算，契约测试通过注入获得。
function runConfigKernelRepositoryConformance({ assert, label, createRepository, sha256Digest }) {
  if (!assert || typeof createRepository !== "function" || typeof sha256Digest !== "function") {
    throw new Error("conformance requires assert, createRepository and sha256Digest");
  }
  const results = [];
  const record = (name, fn) => {
    fn();
    results.push(name);
  };
  const throwsCode = (fn, code) => {
    assert.throws(fn, (error) => error && error.code === code);
  };

  function signed(doc) {
    const content = Object.assign({}, doc);
    delete content.digest;
    return Object.assign({}, content, { digest: sha256Digest(content) });
  }

  record(`${label}: exposes the full repository method set`, () => {
    const repo = createRepository();
    REPOSITORY_METHODS.forEach((method) => {
      assert.strictEqual(typeof repo[method], "function", `${method} must be implemented`);
    });
  });

  record(`${label}: draft round-trip and isolation per environment`, () => {
    const repo = createRepository();
    const draft = { domain: "skill", artifactId: "conformance", environment: "trial", payload: { a: 1 }, updatedAt: "t", updatedBy: "u" };
    repo.putDraft(draft);
    assert.deepStrictEqual(repo.getDraft("skill", "conformance", "trial"), draft);
    assert.strictEqual(repo.getDraft("skill", "conformance", "dev"), null);
    assert.strictEqual(repo.getDraft("skill", "missing", "trial"), null);
  });

  record(`${label}: versions are immutable and listed in order`, () => {
    const repo = createRepository();
    repo.putVersion(signed(baseVersionDoc({ version: 1 })));
    repo.putVersion(signed(baseVersionDoc({ version: 2, payload: { skills: [{ id: "beta" }] } })));
    throwsCode(() => repo.putVersion(signed(baseVersionDoc({ version: 1 }))), "CONFIG_KERNEL_VERSION_EXISTS");
    assert.deepStrictEqual(repo.listVersions("skill", "conformance", "trial"), [1, 2]);
    assert.deepStrictEqual(repo.listVersions("skill", "conformance", "public"), []);
    assert.strictEqual(repo.getVersion("skill", "conformance", "trial", 2).payload.skills[0].id, "beta");
    assert.strictEqual(repo.getVersion("skill", "conformance", "trial", 9), null);
  });

  record(`${label}: pointers default empty and round-trip`, () => {
    const repo = createRepository();
    const empty = repo.readPointers("trial");
    assert.strictEqual(empty.seq, 0);
    assert.deepStrictEqual(empty.artifacts, {});
    const next = { environment: "trial", seq: 3, artifacts: { "skill:conformance": 2 }, updatedAt: "t" };
    repo.writePointers(next);
    assert.deepStrictEqual(repo.readPointers("trial"), next);
  });

  record(`${label}: snapshots are retrievable by configVersion`, () => {
    const repo = createRepository();
    const snap = signed(baseSnapshot());
    repo.putSnapshot(snap);
    assert.deepStrictEqual(repo.getSnapshot("trial", snap.configVersion), snap);
    assert.strictEqual(repo.getSnapshot("trial", "cfg-trial-9999-000000000000"), null);
    assert.deepStrictEqual(repo.listSnapshots("trial"), [snap.configVersion]);
    assert.deepStrictEqual(repo.listSnapshots("dev"), []);
  });

  record(`${label}: current ref switch is atomic and readable`, () => {
    const repo = createRepository();
    assert.strictEqual(repo.readCurrentRef("trial"), null);
    repo.writeCurrentRef("trial", "cfg-trial-0001-abcdef123456");
    assert.strictEqual(repo.readCurrentRef("trial").configVersion, "cfg-trial-0001-abcdef123456");
    repo.writeCurrentRef("trial", "cfg-trial-0002-abcdef123456");
    assert.strictEqual(repo.readCurrentRef("trial").configVersion, "cfg-trial-0002-abcdef123456");
    assert.strictEqual(repo.readCurrentRef("public"), null);
  });

  record(`${label}: last-known-good round-trip`, () => {
    const repo = createRepository();
    assert.strictEqual(repo.readLkg("trial"), null);
    const snap = signed(baseSnapshot());
    repo.writeLkg("trial", snap);
    assert.deepStrictEqual(repo.readLkg("trial"), snap);
  });

  record(`${label}: audit appends in order and respects limit`, () => {
    const repo = createRepository();
    repo.appendAudit({ at: "t1", op: "one", result: "ok" });
    repo.appendAudit({ at: "t2", op: "two", result: "ok" });
    assert.deepStrictEqual(repo.listAudit({ limit: 10 }).map((entry) => entry.op), ["one", "two"]);
    assert.deepStrictEqual(repo.listAudit({ limit: 1 }).map((entry) => entry.op), ["two"]);
  });

  record(`${label}: unsafe path segments are rejected`, () => {
    const repo = createRepository();
    throwsCode(() => repo.getDraft("sk../ill", "x", "trial"), "CONFIG_KERNEL_PATH_SEGMENT_INVALID");
    throwsCode(() => repo.getVersion("skill", "conformance", "trial", 0), "CONFIG_KERNEL_VERSION_INVALID");
  });

  return Object.freeze(results);
}

module.exports = Object.freeze({
  runConfigKernelRepositoryConformance,
});
