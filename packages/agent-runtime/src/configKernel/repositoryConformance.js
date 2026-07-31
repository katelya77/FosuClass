// P4a：Config Kernel Repository 契约测试（conformance suite）。
// 同一套契约对文件适配器与 PostgreSQL 适配器（P5a WS2）分别运行：
//   const { runConfigKernelRepositoryConformance } = require("...");
//   await runConfigKernelRepositoryConformance({ assert, label: "file", createRepository: () => ... });
// 每个用例在全新 repository 实例上执行（调用方负责隔离/清理）。
// P5a 起用例与 runner 均为 async：文件适配器的同步返回被 await 透明容忍，
// createRepository 也可返回 Promise（PG 侧需要建库/迁移）。

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
async function runConfigKernelRepositoryConformance({ assert, label, createRepository, sha256Digest }) {
  if (!assert || typeof createRepository !== "function" || typeof sha256Digest !== "function") {
    throw new Error("conformance requires assert, createRepository and sha256Digest");
  }
  const results = [];
  const record = async (name, fn) => {
    await Promise.resolve(fn());
    results.push(name);
  };
  // 同步抛（文件适配器）与异步拒绝（PG 适配器）统一经 async 包装进入 assert.rejects。
  const throwsCode = async (fn, code) => {
    await assert.rejects(async () => {
      await fn();
    }, (error) => error && error.code === code);
  };

  function signed(doc) {
    const content = Object.assign({}, doc);
    delete content.digest;
    return Object.assign({}, content, { digest: sha256Digest(content) });
  }

  await record(`${label}: exposes the full repository method set`, async () => {
    const repo = await createRepository();
    REPOSITORY_METHODS.forEach((method) => {
      assert.strictEqual(typeof repo[method], "function", `${method} must be implemented`);
    });
  });

  await record(`${label}: draft round-trip and isolation per environment`, async () => {
    const repo = await createRepository();
    const draft = { domain: "skill", artifactId: "conformance", environment: "trial", payload: { a: 1 }, updatedAt: "t", updatedBy: "u" };
    await repo.putDraft(draft);
    assert.deepStrictEqual(await repo.getDraft("skill", "conformance", "trial"), draft);
    assert.strictEqual(await repo.getDraft("skill", "conformance", "dev"), null);
    assert.strictEqual(await repo.getDraft("skill", "missing", "trial"), null);
  });

  await record(`${label}: versions are immutable and listed in order`, async () => {
    const repo = await createRepository();
    await repo.putVersion(signed(baseVersionDoc({ version: 1 })));
    await repo.putVersion(signed(baseVersionDoc({ version: 2, payload: { skills: [{ id: "beta" }] } })));
    await throwsCode(() => repo.putVersion(signed(baseVersionDoc({ version: 1 }))), "CONFIG_KERNEL_VERSION_EXISTS");
    assert.deepStrictEqual(await repo.listVersions("skill", "conformance", "trial"), [1, 2]);
    assert.deepStrictEqual(await repo.listVersions("skill", "conformance", "public"), []);
    assert.strictEqual((await repo.getVersion("skill", "conformance", "trial", 2)).payload.skills[0].id, "beta");
    assert.strictEqual(await repo.getVersion("skill", "conformance", "trial", 9), null);
  });

  await record(`${label}: pointers default empty and round-trip`, async () => {
    const repo = await createRepository();
    const empty = await repo.readPointers("trial");
    assert.strictEqual(empty.seq, 0);
    assert.deepStrictEqual(empty.artifacts, {});
    const next = { environment: "trial", seq: 3, artifacts: { "skill:conformance": 2 }, updatedAt: "t" };
    await repo.writePointers(next);
    assert.deepStrictEqual(await repo.readPointers("trial"), next);
  });

  await record(`${label}: snapshots are retrievable by configVersion`, async () => {
    const repo = await createRepository();
    const snap = signed(baseSnapshot());
    await repo.putSnapshot(snap);
    assert.deepStrictEqual(await repo.getSnapshot("trial", snap.configVersion), snap);
    assert.strictEqual(await repo.getSnapshot("trial", "cfg-trial-9999-000000000000"), null);
    assert.deepStrictEqual(await repo.listSnapshots("trial"), [snap.configVersion]);
    assert.deepStrictEqual(await repo.listSnapshots("dev"), []);
  });

  await record(`${label}: current ref switch is atomic and readable`, async () => {
    const repo = await createRepository();
    assert.strictEqual(await repo.readCurrentRef("trial"), null);
    await repo.writeCurrentRef("trial", "cfg-trial-0001-abcdef123456");
    assert.strictEqual((await repo.readCurrentRef("trial")).configVersion, "cfg-trial-0001-abcdef123456");
    await repo.writeCurrentRef("trial", "cfg-trial-0002-abcdef123456");
    assert.strictEqual((await repo.readCurrentRef("trial")).configVersion, "cfg-trial-0002-abcdef123456");
    assert.strictEqual(await repo.readCurrentRef("public"), null);
  });

  await record(`${label}: last-known-good round-trip`, async () => {
    const repo = await createRepository();
    assert.strictEqual(await repo.readLkg("trial"), null);
    const snap = signed(baseSnapshot());
    await repo.writeLkg("trial", snap);
    assert.deepStrictEqual(await repo.readLkg("trial"), snap);
  });

  await record(`${label}: audit appends in order and respects limit`, async () => {
    const repo = await createRepository();
    await repo.appendAudit({ at: "t1", op: "one", result: "ok" });
    await repo.appendAudit({ at: "t2", op: "two", result: "ok" });
    assert.deepStrictEqual((await repo.listAudit({ limit: 10 })).map((entry) => entry.op), ["one", "two"]);
    assert.deepStrictEqual((await repo.listAudit({ limit: 1 })).map((entry) => entry.op), ["two"]);
  });

  await record(`${label}: unsafe path segments are rejected`, async () => {
    const repo = await createRepository();
    await throwsCode(() => repo.getDraft("sk../ill", "x", "trial"), "CONFIG_KERNEL_PATH_SEGMENT_INVALID");
    await throwsCode(() => repo.getVersion("skill", "conformance", "trial", 0), "CONFIG_KERNEL_VERSION_INVALID");
  });

  return Object.freeze(results);
}

module.exports = Object.freeze({
  runConfigKernelRepositoryConformance,
});
