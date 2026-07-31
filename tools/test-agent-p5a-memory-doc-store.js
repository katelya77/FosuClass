#!/usr/bin/env node
// P5a WS4b：user-memory 文档存储 seam（文件实现抽取）+ PostgreSQL 文档存储的真实验证。
//
// 离线段（任何环境都执行）：
//   - migration 0004 经 pgPersistenceService.getMigrationList() 目录自动发现
//     （新增文件即生效，未改 pgPersistenceService.js）；
//   - FileMemoryDocumentStore 单测：rootDir 必填 / filePath 隔离形状 /
//     load 缺失 → null / save→load 字节往返 / tmp+rename 无残留 / withLock 串行；
//   - UserPreferenceService 注入 seam：默认构造仍得文件 store；注入 spy store
//     后调用确实经 store 原语；默认路径行为抽查（信封形状 / dedupe 不写 /
//     expectedRevision 冲突码 / clear）；
//   - v1→v2：服务读取迁移 + 回写 v2 信封（迁移逻辑在服务层）。
//
// PG 段（AGENT_TEST_PG_URL 或 docker 临时容器；不可用 → UNVERIFIED exit 0）：
//   - runMigrations 应用 version 4、agent_user_memory 表存在；
//   - PgMemoryDocumentStore CRUD / revision CAS（单语句原子：
//     缺失 ≡ revision 0；stale expectedRevision → MEMORY_REVISION_CONFLICT，
//     与服务层 typedError 同构）/ 并发 CAS 恰一成一败 / principal 隔离；
//   - 文档级 parity：同一组「服务真实产生的密文信封 + revision 链」重放到
//     文件 store 与 PG store，最终字节与 revision 一致、CAS 冲突行为一致。
//     对比点说明（诚实分层）：加密与 v1→v2 迁移在服务层（store 之上），
//     store 层对比的是「不透明密文信封的持久化往返 + revision CAS 链」；
//     文件实现的 CAS 判定由服务层 assertExpectedRevision 提供，parity 中
//     文件侧 harness 在同一把锁内逐字复刻该判定（缺失文档 ≡ revision 0）。

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");

process.env.NODE_ENV = "test";

const {
  FileMemoryDocumentStore,
  createFileMemoryDocumentStore,
} = require("../server/src/services/ai/conversation/fileMemoryDocumentStore");
const { UserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");
const {
  PgMemoryDocumentStore,
  createPgMemoryDocumentStore,
} = require("../server/src/services/ai/conversation/pgMemoryDocumentStore");
const { closePool, createPgPool, query } = require("../packages/agent-runtime");

const SECRET = "p5a-doc-store-test-secret";
const NOW_ISO = "2026-07-31T00:00:00.000Z";
const clock = { now: () => Date.parse(NOW_ISO) };

// ---------- 工具 ----------
async function errorCode(fn) {
  try {
    await fn();
  } catch (error) {
    return (error && error.code) || "NO_CODE";
  }
  return "NO_THROW";
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

// 与服务层 encryptObject 同构的 legacy v1 信封构造（AAD = principalKey）。
function encryptLegacy(values, secret, principalKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(principalKey));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(values), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function legacyV1Text(values, principalKey) {
  return `${JSON.stringify({
    schemaVersion: "user-preferences.v1",
    principalShard: String(principalKey).slice(0, 16),
    updatedAt: NOW_ISO,
    encrypted: encryptLegacy(values, SECRET, principalKey),
  }, null, 2)}\n`;
}

function memoryInput(principal, key, value, extra = {}) {
  return {
    principal,
    memoryMode: "cloud_sync",
    explicit: true,
    entry: {
      kind: "stable_preference",
      key,
      content: `${key}=${String(value)}`,
      normalizedValue: value,
      provenance: { type: "user_explicit" },
      confidence: 0.98,
      scope: "user",
      ...extra,
    },
  };
}

function spyStore(inner) {
  const counts = { filePath: 0, withLock: 0, load: 0, save: 0, statMtimeMs: 0 };
  return {
    counts,
    filePath: (key) => {
      counts.filePath += 1;
      return inner.filePath(key);
    },
    withLock: (key, callback) => {
      counts.withLock += 1;
      return inner.withLock(key, callback);
    },
    load: (filePath) => {
      counts.load += 1;
      return inner.load(filePath);
    },
    save: (filePath, text) => {
      counts.save += 1;
      return inner.save(filePath, text);
    },
    statMtimeMs: (filePath) => {
      counts.statMtimeMs += 1;
      return inner.statMtimeMs(filePath);
    },
  };
}

// ---------- 离线段 ----------
function testMigrationDiscovery() {
  delete process.env.AGENT_PG_URL;
  const { getMigrationList } = require("../server/src/services/ai/persistence/pgPersistenceService");
  const list = getMigrationList();
  const v4 = list.find((migration) => migration.version === 4);
  assert.ok(v4, "version 4 必须经目录自动发现（新增文件即生效，不改 pgPersistenceService）");
  assert.strictEqual(v4.name, "user_memory");
  const ddl = v4.statements.join("\n");
  assert.ok(ddl.includes("CREATE TABLE IF NOT EXISTS agent_user_memory"), "0004 必须建 agent_user_memory");
  assert.ok(ddl.includes("principal_key text PRIMARY KEY"), "principal_key 单列主键");
  assert.ok(ddl.includes("doc text NOT NULL"), "doc text NOT NULL");
  assert.ok(ddl.includes("revision bigint NOT NULL DEFAULT 0"), "revision bigint NOT NULL DEFAULT 0");
  console.log("✓ migration 0004 目录自动发现（version 4 / user_memory / agent_user_memory DDL）");
}

function testFileStorePrimitives() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p5a-file-doc-store-"));
  try {
    assert.throws(
      () => new FileMemoryDocumentStore({}),
      (error) => error && error.code === "MEMORY_STORE_ROOT_REQUIRED"
    );

    const store = createFileMemoryDocumentStore({ rootDir: root });
    // filePath 形状：64-hex 保持部署路径；其余 principal digest 隔离。
    const hmacKey = "a".repeat(64);
    assert.strictEqual(
      store.filePath(hmacKey),
      path.join(root, hmacKey.slice(0, 16), "preferences.json")
    );
    const shortKey = "p5a-short-principal";
    const isolated = crypto.createHash("sha256").update(shortKey).digest("hex").slice(0, 24);
    assert.strictEqual(
      store.filePath(shortKey),
      path.join(root, shortKey.slice(0, 16), isolated, "preferences.json")
    );

    // load 缺失 → null（不建目录、不抛错）。
    const fp = store.filePath(shortKey);
    assert.strictEqual(store.load(fp), null);

    // save → load 字节往返（含 unicode / 换行），无 .tmp 残留。
    const docText = "{\"envelope\":\"不透明密文 ☕\\n换行\"}\n";
    store.save(fp, docText);
    assert.strictEqual(store.load(fp), docText);
    assert.strictEqual(store.statMtimeMs(fp) > 0, true);
    const leftovers = [];
    fs.readdirSync(root, { recursive: true }).forEach((entry) => {
      if (String(entry).endsWith(".tmp")) leftovers.push(String(entry));
    });
    assert.deepStrictEqual(leftovers, [], "tmp+rename 后不得残留 .tmp");

    // withLock：callback 收到同一 filePath；锁文件在锁内存在、释放后移除；可连续再进。
    const seen = store.withLock(shortKey, (lockedPath) => {
      assert.strictEqual(lockedPath, fp);
      assert.ok(fs.existsSync(`${fp}.lock`), "锁内必须存在 .lock 文件");
      return "inside";
    });
    assert.strictEqual(seen, "inside");
    assert.ok(!fs.existsSync(`${fp}.lock`), "释放后 .lock 必须移除");
    const again = store.withLock(shortKey, () => "again");
    assert.strictEqual(again, "again");
    console.log("✓ FileMemoryDocumentStore：rootDir 校验 / filePath 隔离 / 字节往返 / 原子写 / withLock");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testServiceInjectionSeam() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p5a-service-seam-"));
  try {
    const principal = { authenticated: true, principalKey: "p5a-seam-owner" };

    // 默认构造：documentStore 为文件实现，rootDir 与服务一致。
    const defaultService = new UserPreferenceService({ dataDir: path.join(root, "default"), secret: SECRET, clock });
    assert.ok(defaultService.documentStore instanceof FileMemoryDocumentStore);
    assert.strictEqual(defaultService.documentStore.rootDir, defaultService.rootDir);

    // 注入 spy：所有持久化原语调用必须经注入 store。
    const inner = createFileMemoryDocumentStore({ rootDir: path.join(root, "spy") });
    const spy = spyStore(inner);
    const service = new UserPreferenceService({
      dataDir: path.join(root, "ignored-when-injected"),
      secret: SECRET,
      clock,
      documentStore: spy,
    });
    const upserted = service.upsertMemory(memoryInput(principal, "preferredName", "阿佛"));
    assert.strictEqual(upserted.persisted, true);
    assert.strictEqual(upserted.revision, 1);
    assert.ok(spy.counts.withLock >= 1 && spy.counts.load >= 1 && spy.counts.save >= 1,
      `写路径必须经注入 store，实际 ${JSON.stringify(spy.counts)}`);
    const loadBefore = spy.counts.load;
    const values = service.getObject({ principal });
    assert.strictEqual(values.preferredName, "阿佛");
    assert.ok(spy.counts.load > loadBefore, "读路径必须经注入 store.load");
    service.filePath(principal.principalKey);
    assert.ok(spy.counts.filePath >= 1, "filePath 必须委托注入 store");
    // 数据落在 spy 的 rootDir，而非服务 dataDir。
    assert.ok(fs.existsSync(inner.filePath(principal.principalKey)));

    // 默认路径行为抽查（完整行为由既有记忆电池覆盖）：
    const owner = { authenticated: true, principalKey: "p5a-default-owner" };
    const first = defaultService.upsertMemory(memoryInput(owner, "campus", "仙溪校区"));
    assert.strictEqual(first.persisted, true);
    const envelope = JSON.parse(fs.readFileSync(defaultService.filePath(owner.principalKey), "utf8"));
    assert.strictEqual(envelope.schemaVersion, "user-memory.v2");
    assert.strictEqual(typeof envelope.encrypted.ciphertext, "string");
    assert.strictEqual(envelope.revision, 1);
    const duplicate = defaultService.upsertMemory(memoryInput(owner, "campus", "仙溪校区"));
    assert.strictEqual(duplicate.persisted, false);
    assert.strictEqual(duplicate.reason, "MEMORY_DEDUPLICATED");
    assert.strictEqual(duplicate.revision, 1, "dedupe 不得产生 revision");
    const conflict = (() => {
      try {
        defaultService.upsertMemory(memoryInput(owner, "preferredBuilding", "C7", {}, ));
        return "NO_THROW";
      } catch (error) {
        return (error && error.code) || "NO_CODE";
      }
    })();
    assert.strictEqual(conflict, "NO_THROW", "不带 expectedRevision 的写不得冲突");
    const stale = (() => {
      try {
        defaultService.upsertMemory({ ...memoryInput(owner, "preferredBuilding", "C7"), expectedRevision: 99 });
        return "NO_THROW";
      } catch (error) {
        return (error && error.code) || "NO_CODE";
      }
    })();
    assert.strictEqual(stale, "MEMORY_REVISION_CONFLICT");
    const cleared = defaultService.clear({ principal: owner });
    assert.strictEqual(cleared.success, true);
    console.log("✓ 服务注入 seam：默认文件 store / spy 原语计数 / 默认路径行为抽查");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 生成一组「服务真实密文信封 + revision 链」，供 parity 重放（离线产生，双段可用）。
function produceCiphertextChain(root) {
  const service = new UserPreferenceService({ dataDir: root, secret: SECRET, clock });
  const principal = { authenticated: true, principalKey: "p5a-parity-owner-0001" };
  const filePath = service.filePath(principal.principalKey);
  const readRaw = () => {
    const text = fs.readFileSync(filePath, "utf8");
    return { text, revision: JSON.parse(text).revision };
  };
  const steps = [];

  const up1 = service.upsertMemory(memoryInput(principal, "preferredName", "阿佛"));
  assert.strictEqual(up1.revision, 1);
  steps.push({ op: "upsert preferredName", expectedRevision: 0, ...readRaw() });

  const up2 = service.upsertMemory(memoryInput(principal, "campus", "仙溪校区"));
  assert.strictEqual(up2.revision, 2);
  steps.push({ op: "upsert campus", expectedRevision: 1, ...readRaw() });

  // dedupe：服务不写文件（revision 不变）——两侧都必须无写。
  const beforeDedupe = readRaw();
  const dup = service.upsertMemory(memoryInput(principal, "campus", "仙溪校区"));
  assert.strictEqual(dup.persisted, false);
  assert.strictEqual(dup.revision, 2);
  assert.strictEqual(readRaw().text, beforeDedupe.text, "dedupe 后文件不得变化");

  const policy = service.setMemoryPolicy({ principal, patch: { paused: true } });
  assert.strictEqual(policy.revision, 3);
  steps.push({ op: "setMemoryPolicy paused", expectedRevision: 2, ...readRaw() });

  const cleared = service.clear({ principal });
  assert.strictEqual(cleared.revision, 4);
  steps.push({ op: "clear", expectedRevision: 3, ...readRaw() });

  // v1→v2：种子 legacy 文件 → 服务读取迁移 → 显式写回 v2 信封。
  const legacyOwner = { authenticated: true, principalKey: "p5a-parity-legacy-0002" };
  const legacyPath = service.filePath(legacyOwner.principalKey);
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  const legacyText = legacyV1Text({ preferredName: "阿佛", campus: "仙溪校区" }, legacyOwner.principalKey);
  fs.writeFileSync(legacyPath, legacyText, "utf8");
  const migrated = service.getObject({ principal: legacyOwner });
  assert.strictEqual(migrated.preferredName, "阿佛", "v1 读取必须迁移出 preferredName");
  assert.strictEqual(migrated.campus, "仙溪校区", "v1 读取必须迁移出 campus");
  const legacyUpsert = service.upsertMemory(memoryInput(legacyOwner, "grade", "大二"));
  assert.strictEqual(legacyUpsert.revision, 2, "legacy 迁移文档 revision 1 → 写后 2");
  const legacyRaw = fs.readFileSync(legacyPath, "utf8");
  assert.strictEqual(JSON.parse(legacyRaw).schemaVersion, "user-memory.v2", "回写必须是 v2 信封");

  return {
    principalKey: principal.principalKey,
    steps,
    finalRaw: readRaw(),
    legacy: {
      principalKey: legacyOwner.principalKey,
      seedText: legacyText,
      migratedText: legacyRaw,
      revision: JSON.parse(legacyRaw).revision,
    },
  };
}

// 文件侧 parity harness：在同一把锁内逐字复刻服务层 assertExpectedRevision 判定
// （expectedRevision 提供且与当前文档不符 → MEMORY_REVISION_CONFLICT；
// 缺失文档 ≡ revision 0，与服务 emptyDocument 语义一致）。
function fileHarness(store) {
  return {
    async load(key) {
      return store.withLock(key, (filePath) => {
        const text = store.load(filePath);
        if (text === null) return null;
        return { doc: text, revision: JSON.parse(text).revision };
      });
    },
    async save(key, doc, options = {}) {
      return store.withLock(key, (filePath) => {
        const current = store.load(filePath);
        const currentRevision = current === null ? 0 : JSON.parse(current).revision;
        const expected = options.expectedRevision;
        if (expected !== undefined && expected !== null && Number(expected) !== currentRevision) {
          const error = new Error("Memory revision conflict");
          error.code = "MEMORY_REVISION_CONFLICT";
          error.statusCode = 409;
          throw error;
        }
        store.save(filePath, doc);
        return { revision: Number(options.revision) };
      });
    },
  };
}

// ---------- PG 段 ----------
async function withPgDatabase(env, fn) {
  const adminPool = createPgPool({ connectionString: env.url, max: 2 });
  const dbName = `agent_p5a_memdoc_${crypto.randomBytes(5).toString("hex")}`;
  await query(adminPool, `CREATE DATABASE ${dbName}`);
  const url = new URL(env.url);
  url.pathname = `/${dbName}`;
  process.env.AGENT_PG_URL = url.toString();
  // 注意：必须在设置 AGENT_PG_URL 之后首次触达 pgPersistenceService。
  const pgPersistenceService = require("../server/src/services/ai/persistence/pgPersistenceService");
  try {
    const migrated = await pgPersistenceService.runMigrations();
    assert.ok(migrated.applied.includes(4), `空库迁移必须应用 0004，实际 [${migrated.applied.join(", ")}]`);
    const pool = pgPersistenceService.getPool();
    const reg = await query(pool, "SELECT to_regclass('agent_user_memory') AS reg");
    assert.ok(reg.rows[0].reg, "agent_user_memory 必须存在");
    await fn(pool);
  } finally {
    await pgPersistenceService.closeForTests();
    delete process.env.AGENT_PG_URL;
    await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await closePool(adminPool);
  }
}

async function testPgStoreCrudAndCas(pool) {
  assert.throws(
    () => new PgMemoryDocumentStore({}),
    (error) => error && error.code === "PG_CONFIG_REQUIRED"
  );
  const store = createPgMemoryDocumentStore({ pool });
  const key = "p5a-pg-owner";

  // 校验类路径不触网也可判定（stub pool 即可），这里一并覆盖。
  const stub = createPgMemoryDocumentStore({ pool: {} });
  assert.strictEqual(await stub.load(""), null);
  assert.strictEqual(await errorCode(() => stub.save("", "x", { revision: 1 })), "PRINCIPAL_REQUIRED");
  assert.strictEqual(await errorCode(() => stub.save("k", "x", { revision: Number.NaN })), "MEMORY_REVISION_INVALID");
  assert.strictEqual(await errorCode(() => stub.save("k", "x", { revision: -1 })), "MEMORY_REVISION_INVALID");
  assert.strictEqual(await errorCode(() => stub.save("k", "x", { expectedRevision: -1, revision: 1 })), "MEMORY_REVISION_INVALID");

  // load 缺失 → null。
  assert.strictEqual(await store.load(key), null);

  // 新文档：缺失 ≡ revision 0，expectedRevision 0 → 插入成功；字节往返（含 unicode/换行）。
  const doc1 = "{\"envelope\":\"密文往返 ☕\\nnewline\"}\n";
  await store.save(key, doc1, { expectedRevision: 0, revision: 1 });
  const loaded1 = await store.load(key);
  assert.strictEqual(loaded1.doc, doc1);
  assert.strictEqual(loaded1.revision, 1);

  // 正确基线 → 覆盖成功。
  const doc2 = "{\"envelope\":\"v2\"}\n";
  await store.save(key, doc2, { expectedRevision: 1, revision: 2 });
  assert.strictEqual((await store.load(key)).revision, 2);

  // 过期基线 → MEMORY_REVISION_CONFLICT（与服务层 typedError 同构），且不落盘。
  let conflictError = null;
  try {
    await store.save(key, "{\"stale\":true}", { expectedRevision: 1, revision: 3 });
  } catch (error) {
    conflictError = error;
  }
  assert.ok(conflictError, "过期 expectedRevision 必须抛错");
  assert.strictEqual(conflictError.code, "MEMORY_REVISION_CONFLICT");
  assert.strictEqual(conflictError.statusCode, 409);
  assert.strictEqual(conflictError.message, "Memory revision conflict");
  assert.strictEqual((await store.load(key)).doc, doc2, "冲突后原文档不得被覆盖");

  // 缺失行 + 非零基线 → 冲突（缺失 ≡ revision 0）。
  assert.strictEqual(
    await errorCode(() => store.save("p5a-pg-missing", "x", { expectedRevision: 5, revision: 6 })),
    "MEMORY_REVISION_CONFLICT"
  );

  // 无条件 upsert（迁移/运维路径）。
  const doc3 = "{\"envelope\":\"v3\"}\n";
  await store.save(key, doc3, { revision: 3 });
  assert.strictEqual((await store.load(key)).doc, doc3);

  // principal 隔离。
  assert.strictEqual(await store.load("p5a-pg-other"), null);

  // 并发 CAS：同一基线两写，恰好一成一败。
  const raceKey = "p5a-pg-race";
  await store.save(raceKey, "{\"base\":true}", { expectedRevision: 0, revision: 1 });
  const settled = await Promise.allSettled([
    store.save(raceKey, "{\"race\":\"a\"}", { expectedRevision: 1, revision: 2 }),
    store.save(raceKey, "{\"race\":\"b\"}", { expectedRevision: 1, revision: 2 }),
  ]);
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  const rejected = settled.filter((result) => result.status === "rejected");
  assert.strictEqual(fulfilled.length, 1, `并发 CAS 必须恰好一个成功，实际 ${settled.map((r) => r.status).join(",")}`);
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(rejected[0].reason && rejected[0].reason.code, "MEMORY_REVISION_CONFLICT");
  assert.strictEqual((await store.load(raceKey)).revision, 2);
  console.log("✓ PgMemoryDocumentStore：CRUD / 字节往返 / CAS 同构冲突码 / 无条件 upsert / 并发一胜一负 / 隔离");
}

async function testParity(pool, chain) {
  const pgStore = createPgMemoryDocumentStore({ pool });
  const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p5a-parity-file-"));
  try {
    const file = fileHarness(createFileMemoryDocumentStore({ rootDir: fileRoot }));
    const pg = {
      load: (key) => pgStore.load(key),
      save: (key, doc, options) => pgStore.save(key, doc, options),
    };

    // 同一组密文信封 + revision 链重放两侧。
    for (const step of chain.steps) {
      await file.save(chain.principalKey, step.text, { expectedRevision: step.expectedRevision, revision: step.revision });
      await pg.save(chain.principalKey, step.text, { expectedRevision: step.expectedRevision, revision: step.revision });
    }
    const fileFinal = await file.load(chain.principalKey);
    const pgFinal = await pg.load(chain.principalKey);
    assert.strictEqual(pgFinal.doc, fileFinal.doc, "重放后两侧文档字节必须一致");
    assert.strictEqual(pgFinal.doc, chain.finalRaw.text, "两侧文档必须等于服务真实落盘文本");
    assert.strictEqual(pgFinal.revision, chain.finalRaw.revision);
    assert.strictEqual(fileFinal.revision, chain.finalRaw.revision);

    // CAS 冲突行为一致：过期基线两侧同码，且两侧原文档都保持不变。
    const staleOptions = { expectedRevision: chain.finalRaw.revision - 1, revision: 99 };
    assert.strictEqual(
      await errorCode(() => file.save(chain.principalKey, "{\"stale\":1}", staleOptions)),
      "MEMORY_REVISION_CONFLICT"
    );
    assert.strictEqual(
      await errorCode(() => pg.save(chain.principalKey, "{\"stale\":1}", staleOptions)),
      "MEMORY_REVISION_CONFLICT"
    );
    assert.strictEqual((await file.load(chain.principalKey)).doc, chain.finalRaw.text);
    assert.strictEqual((await pg.load(chain.principalKey)).doc, chain.finalRaw.text);

    // 无条件 upsert 行为一致。
    await file.save(chain.principalKey, chain.finalRaw.text, { revision: chain.finalRaw.revision });
    await pg.save(chain.principalKey, chain.finalRaw.text, { revision: chain.finalRaw.revision });
    assert.strictEqual((await pg.load(chain.principalKey)).doc, (await file.load(chain.principalKey)).doc);

    // v1→v2：迁移在服务层完成（见 produceCiphertextChain）；store 层断言
    // 迁移产物的密文信封在两侧持久化往返一致（PG 侧以 seed revision 0 为基线重放）。
    await pg.save(chain.legacy.principalKey, chain.legacy.seedText, { expectedRevision: 0, revision: 0 });
    await pg.save(chain.legacy.principalKey, chain.legacy.migratedText, {
      expectedRevision: 0,
      revision: chain.legacy.revision,
    });
    const pgLegacy = await pg.load(chain.legacy.principalKey);
    assert.strictEqual(pgLegacy.doc, chain.legacy.migratedText, "迁移产物密文 PG 往返必须字节一致");
    assert.strictEqual(pgLegacy.revision, chain.legacy.revision);
    console.log("✓ parity：密文链重放字节一致 / revision 链一致 / CAS 冲突同码 / v1→v2 迁移产物往返一致");
  } finally {
    fs.rmSync(fileRoot, { recursive: true, force: true });
  }
}

(async () => {
  // ---------- 离线段 ----------
  testMigrationDiscovery();
  testFileStorePrimitives();
  testServiceInjectionSeam();
  const chainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p5a-chain-"));
  let chain;
  try {
    chain = produceCiphertextChain(chainRoot);
  } finally {
    fs.rmSync(chainRoot, { recursive: true, force: true });
  }
  console.log("✓ 密文链生成：upsert×2 / dedupe 无写 / policy / clear / v1→v2 迁移回写");

  // ---------- PG 段 ----------
  let reason = "no PostgreSQL available";
  // P5a WS5：migration 0005 起基线镜像为 pgvector/pgvector:pg16（CREATE EXTENSION vector）。
  const env = await ensurePg({ image: "pgvector/pgvector:pg16", onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\ntest-agent-p5a-memory-doc-store: offline PASS; postgres UNVERIFIED (${reason})`);
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  try {
    await withPgDatabase(env, async (pool) => {
      await testPgStoreCrudAndCas(pool);
      await testParity(pool, chain);
    });
  } finally {
    await env.cleanup();
  }
  console.log("\ntest-agent-p5a-memory-doc-store: PASS");
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
