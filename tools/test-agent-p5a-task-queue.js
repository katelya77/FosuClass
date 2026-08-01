#!/usr/bin/env node
// P5a WS5：任务队列契约 parity 测试（file / Redis Streams 双实现）。
//
// 覆盖：
//   - 契约 parity（同一套件跑双实现）：enqueue 幂等去重、claim/ack 投递闭环、
//     有界重试预算（共享 MAX_ATTEMPTS=3）→ dead-letter、reclaimPending 崩溃回收、
//     requeue 重置、显式 deadLetter、remove、重启后去重仍成立（业务幂等锚）；
//   - Redis 不可用降级诚实语义：enqueue/claim 一律 TASK_QUEUE_REDIS_UNAVAILABLE
//     coded error，任何入口不伪造已入队（本段不依赖 docker，始终执行）；
//   - PG 镜像（Redis 永不作权威源）：任务状态镜像落 agent_task_queue_mirror
//     （migration 0007，与 durable 任务存储分表），簿记 hash 被删后镜像仍
//     权威去重，ack/retry 终态同步（需 PG + Redis）；
//   - reclaim 终态陈旧守卫：簿记已落 done、XACK 丢失的 PEL 残迹被 XACK 清出，
//     不再重投（ack/retry 先簿记后 XACK 顺序的对称吸收侧）。
//
// 环境：AGENT_TEST_REDIS_URL / AGENT_TEST_PG_URL 优先，否则 docker 临时容器
// （redis:7-alpine / postgres:16-alpine）；不可用 → 对应段落 UNVERIFIED 并 exit 0。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFileTaskQueue } = require("../server/src/services/ai/taskQueue/fileTaskQueue");
const { createRedisStreamsTaskQueue } = require("../server/src/services/ai/taskQueue/redisStreamsTaskQueue");
const { MAX_ATTEMPTS } = require("../server/src/services/ai/taskQueue/contract");
const { ensureRedis, redactUrl } = require("./test-helpers/redis-test-env");
const { ensurePg } = require("./test-helpers/pg-test-env");

const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;

function jobInput(suffix, extra = {}) {
  return Object.assign({
    jobId: `job:${RUN_ID}:${suffix}`,
    kind: "rag-index-build",
    payload: { environment: "trial", artifactId: "a", kbId: "kb", version: 1 },
  }, extra);
}

// 同一契约套件跑双实现（parity）。reopen 用于「重启后去重仍成立」。
async function contractSuite(label, createQueue, reopenQueue) {
  const queue = await createQueue();

  // enqueue + 幂等去重
  const first = await queue.enqueue(jobInput("dedup"));
  assert.deepStrictEqual(first, { jobId: first.jobId, status: "pending", deduped: false }, `${label}: fresh enqueue`);
  const dupe = await queue.enqueue(jobInput("dedup"));
  assert.strictEqual(dupe.deduped, true, `${label}: same jobId deduped`);
  assert.strictEqual(dupe.status, "pending", `${label}: deduped keeps current status`);

  // claim/ack 投递闭环
  const claimed = await queue.claim({ consumer: "c1" });
  assert.ok(claimed, `${label}: claim returns the pending job`);
  assert.strictEqual(claimed.jobId, first.jobId);
  assert.strictEqual(claimed.status, "building");
  assert.strictEqual(claimed.payload.kbId, "kb", `${label}: payload rides along`);
  assert.strictEqual(await queue.claim({ consumer: "c1" }), null, `${label}: nothing else pending`);
  const acked = await queue.ack(claimed);
  assert.strictEqual(acked.status, "done", `${label}: ack completes the delivery`);
  assert.strictEqual((await queue.get(first.jobId)).status, "done");

  // 有界重试预算 → dead-letter
  await queue.enqueue(jobInput("retry"));
  let jobId = `job:${RUN_ID}:retry`;
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const picked = await queue.claim({ consumer: "c1" });
    assert.ok(picked && picked.jobId === jobId, `${label}: retry attempt ${attempt} delivered`);
    last = await queue.retry(picked, { errorClass: "RAG_INDEX_BUILD_FAILED", maxAttempts: MAX_ATTEMPTS });
    if (attempt < MAX_ATTEMPTS) {
      assert.strictEqual(last.status, "pending", `${label}: within budget → back to pending`);
      assert.strictEqual(last.attempts, attempt);
    }
  }
  assert.strictEqual(last.status, "failed", `${label}: budget exhausted → dead`);
  assert.strictEqual(last.attempts, MAX_ATTEMPTS, `${label}: shared retry budget is ${MAX_ATTEMPTS}`);
  assert.strictEqual(await queue.claim({ consumer: "c1" }), null, `${label}: dead job never redelivered`);
  const dead = await queue.listDead();
  const deadRecord = dead.find((entry) => entry.jobId === jobId);
  assert.ok(deadRecord, `${label}: dead-letter record exists`);
  assert.strictEqual(deadRecord.attempts, MAX_ATTEMPTS);
  assert.strictEqual(deadRecord.errorClass, "RAG_INDEX_BUILD_FAILED");
  assert.strictEqual(deadRecord.payload.kbId, "kb", `${label}: dead-letter keeps payload`);
  assert.ok(deadRecord.deadAt, `${label}: dead-letter stamped`);

  // reclaimPending：building 停滞（崩溃残留）被回收并重新认领
  await queue.enqueue(jobInput("reclaim"));
  const stalled = await queue.claim({ consumer: "crashed" });
  assert.ok(stalled, `${label}: job claimed by a consumer that then 'crashes'`);
  const reclaimed = await queue.reclaimPending({ consumer: "c2", minIdleMs: 0 });
  const reclaimedJob = reclaimed.find((entry) => entry.jobId === stalled.jobId);
  assert.ok(reclaimedJob, `${label}: stalled building job reclaimed`);
  await queue.ack(reclaimedJob);
  assert.strictEqual((await queue.get(stalled.jobId)).status, "done", `${label}: reclaimed job completes`);

  // requeue：终态/重试中任务重置回 pending（re-pin 即重试语义）
  await queue.enqueue(jobInput("requeue"));
  const requeuePicked = await queue.claim({ consumer: "c1" });
  await queue.retry(requeuePicked, { errorClass: "X", maxAttempts: MAX_ATTEMPTS });
  const requeued = await queue.requeue(requeuePicked.jobId, { resetAttempts: true });
  assert.strictEqual(requeued.status, "pending");
  assert.strictEqual(requeued.attempts, 0, `${label}: requeue resets the budget`);
  const repicked = await queue.claim({ consumer: "c1" });
  assert.strictEqual(repicked.jobId, requeuePicked.jobId, `${label}: requeued job redelivered`);
  await queue.ack(repicked);

  // 显式 deadLetter（预算外人工判死）
  await queue.enqueue(jobInput("explicit-dead"));
  const explicitId = `job:${RUN_ID}:explicit-dead`;
  assert.strictEqual(await queue.deadLetter(explicitId, { errorClass: "TASK_QUEUE_DEAD_LETTER" }), true);
  const explicitDead = (await queue.listDead()).find((entry) => entry.jobId === explicitId);
  assert.ok(explicitDead, `${label}: explicit dead-letter recorded`);
  assert.strictEqual(await queue.deadLetter(`job:${RUN_ID}:missing`, {}), false, `${label}: deadLetter unknown job → false`);

  // remove：done 且产物验证后的幂等清理
  await queue.enqueue(jobInput("remove"));
  const removeId = `job:${RUN_ID}:remove`;
  assert.strictEqual(await queue.remove(removeId), true);
  assert.strictEqual(await queue.get(removeId), null, `${label}: removed job gone`);
  assert.strictEqual(await queue.remove(removeId), false, `${label}: remove unknown → false`);

  // list 形状
  const jobs = await queue.list();
  assert.ok(jobs.length >= 4, `${label}: list reports jobs`);
  jobs.forEach((entry) => {
    assert.ok(entry.jobId && entry.status && entry.payload, `${label}: list entries carry jobId/status/payload`);
  });

  // 重启后去重仍成立（至少一次投递下的业务幂等锚之一）
  await queue.close();
  const reopened = await reopenQueue();
  const afterRestart = await reopened.enqueue(jobInput("dedup"));
  assert.strictEqual(afterRestart.deduped, true, `${label}: dedup survives restart`);
  assert.strictEqual(afterRestart.status, "done", `${label}: restart sees the final state`);
  await reopened.close();

  console.log(`✓ ${label}: enqueue dedup / claim-ack / bounded retry(${MAX_ATTEMPTS}) → dead-letter / reclaim / requeue / restart parity`);
}

async function testFileQueue() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p5a-task-queue-"));
  const file = path.join(dir, "queue.json");
  await contractSuite(
    "file",
    async () => createFileTaskQueue({ file }),
    async () => createFileTaskQueue({ file })
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testRedisUnavailable() {
  // 指向已关闭端口：任何入口都必须如实失败（coded error），不得伪造已入队。
  const queue = createRedisStreamsTaskQueue({
    url: "redis://127.0.0.1:1",
    stream: `agent:p5a-test:unavailable:${RUN_ID}`,
    redisOptions: { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 1, connectTimeout: 500 },
  });
  try {
    await assert.rejects(
      () => queue.enqueue(jobInput("honest")),
      (e) => e.code === "TASK_QUEUE_REDIS_UNAVAILABLE",
      "enqueue must fail honestly when redis is down"
    );
    await assert.rejects(
      () => queue.claim({ consumer: "c1" }),
      (e) => e.code === "TASK_QUEUE_REDIS_UNAVAILABLE",
      "claim must fail honestly when redis is down"
    );
    await assert.rejects(
      () => queue.reclaimPending({ consumer: "c1", minIdleMs: 0 }),
      (e) => e.code === "TASK_QUEUE_REDIS_UNAVAILABLE",
      "reclaim must fail honestly when redis is down"
    );
    // 不伪造：失败即失败，不存在「看似入队成功」的返回值
    const checked = await queue.enqueue(jobInput("honest")).then(() => "FAKED", (error) => error.code);
    assert.strictEqual(checked, "TASK_QUEUE_REDIS_UNAVAILABLE", "no fake enqueue success");
  } finally {
    await queue.close();
  }
  console.log("✓ redis unavailable: enqueue/claim/reclaim all fail with TASK_QUEUE_REDIS_UNAVAILABLE, nothing faked");
}

async function withRedisQueue(env, streamSuffix, fn, extra = {}) {
  const stream = `agent:p5a-test:${RUN_ID}:${streamSuffix}`;
  const queue = createRedisStreamsTaskQueue(Object.assign({ url: env.url, stream, group: "workers" }, extra));
  const Redis = require("ioredis");
  const janitor = new Redis(env.url, { lazyConnect: false });
  try {
    await fn(queue, stream);
  } finally {
    await queue.close();
    // 清理本测试创建的 key（外部 AGENT_TEST_REDIS_URL 场景必须留干净）
    let cursor = "0";
    do {
      const reply = await janitor.scan(cursor, "MATCH", `${stream}*`, "COUNT", 200);
      cursor = reply[0];
      if (reply[1].length) await janitor.del(...reply[1]);
    } while (cursor !== "0");
    await janitor.quit();
  }
}

async function testRedisQueue(env) {
  await withRedisQueue(env, "contract", async (queue, stream) => {
    // restart parity：同 stream/group 新实例（consumer 不同，模拟 worker 重启）
    await contractSuite(
      "redis-streams",
      async () => queue,
      async () => createRedisStreamsTaskQueue({ url: env.url, stream, group: "workers" })
    );
    // contractSuite 里 reopened 实例是 owned 连接，已被其 close() 释放；
    // queue 本身由 withRedisQueue 收尾。
  });
}

async function testPgMirror(redisEnv, pgEnv) {
  const crypto = require("crypto");
  const { closePool, createPgPool, query } = require("../packages/agent-runtime");
  const adminPool = createPgPool({ connectionString: pgEnv.url, max: 2 });
  const dbName = `agent_p5a_tq_${crypto.randomBytes(5).toString("hex")}`;
  await query(adminPool, `CREATE DATABASE ${dbName}`);
  const url = new URL(pgEnv.url);
  url.pathname = `/${dbName}`;
  process.env.AGENT_PG_URL = url.toString();
  const pgPersistenceService = require("../server/src/services/ai/persistence/pgPersistenceService");
  try {
    await pgPersistenceService.runMigrations();
    const pool = pgPersistenceService.getPool();
    const mirrorNamespace = `agent:p5a-test:${RUN_ID}:mirror`;
    const stream = `${mirrorNamespace}:stream`;
    const queue = createRedisStreamsTaskQueue({
      url: redisEnv.url,
      stream,
      group: "workers",
      pool,
      mirrorNamespace,
    });
    const Redis = require("ioredis");
    const janitor = new Redis(redisEnv.url, { lazyConnect: false });
    try {
      // enqueue → 镜像落 PG（pending）
      const input = jobInput("mirrored");
      await queue.enqueue(input);
      const taskId = `tq:${mirrorNamespace}:${input.jobId}`;
      let row = (await query(pool, "SELECT status, doc FROM agent_task_queue_mirror WHERE task_id = $1", [taskId])).rows[0];
      assert.ok(row, "enqueue mirrors into agent_task_queue_mirror");
      assert.strictEqual(row.status, "pending");
      assert.strictEqual(row.doc.payload.kbId, "kb");

      // 簿记 hash 被删（Redis 丢状态）→ 镜像仍权威去重（Redis 永不作权威源）
      await janitor.del(`${stream}:job:${input.jobId}`);
      const dupe = await queue.enqueue(input);
      assert.strictEqual(dupe.deduped, true, "PG mirror is the authoritative dedup anchor");

      // ack → 终态落 PG
      const claimed = await queue.claim({ consumer: "c1" });
      await queue.ack(claimed);
      row = (await query(pool, "SELECT status FROM agent_task_queue_mirror WHERE task_id = $1", [taskId])).rows[0];
      assert.strictEqual(row.status, "done", "ack mirrors the final state to PG");

      // 重试预算耗尽 → failed 终态落 PG + dead-letter stream
      const retryInput = jobInput("mirrored-retry");
      await queue.enqueue(retryInput);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const picked = await queue.claim({ consumer: "c1" });
        await queue.retry(picked, { errorClass: "RAG_INDEX_BUILD_FAILED", maxAttempts: MAX_ATTEMPTS });
      }
      const retryTaskId = `tq:${mirrorNamespace}:${retryInput.jobId}`;
      row = (await query(pool, "SELECT status FROM agent_task_queue_mirror WHERE task_id = $1", [retryTaskId])).rows[0];
      assert.strictEqual(row.status, "failed", "retry exhaustion mirrors failed to PG");
      const dead = await queue.listDead();
      assert.ok(dead.some((entry) => entry.jobId === retryInput.jobId), "dead-letter stream carries the record");

      // reclaim 终态陈旧守卫：簿记已落 done、XACK 丢失的 PEL 残迹必须被
      // XACK 清出，不再重投（ack/retry 先簿记后 XACK 顺序的对称吸收侧）。
      const staleInput = jobInput("stale-acked");
      await queue.enqueue(staleInput);
      const picked = await queue.claim({ consumer: "c1" });
      assert.ok(picked && picked.jobId === staleInput.jobId, "stale-guard setup claims the job");
      // 模拟 ack 簿记已落、XACK 前崩溃：直接写 done 簿记，PEL 条目保留。
      await janitor.hset(`${stream}:job:${staleInput.jobId}`, "status", "done", "updatedAt", new Date().toISOString());
      const reclaimed = await queue.reclaimPending({ minIdleMs: 0 });
      assert.ok(
        !reclaimed.some((job) => job.jobId === staleInput.jobId),
        "terminal-stale PEL entry must not be redelivered"
      );
      const reclaimedAgain = await queue.reclaimPending({ minIdleMs: 0 });
      assert.ok(
        !reclaimedAgain.some((job) => job.jobId === staleInput.jobId),
        "stale entry is XACKed out of the PEL by the guard"
      );
    } finally {
      await queue.close();
      let cursor = "0";
      do {
        const reply = await janitor.scan(cursor, "MATCH", `${stream}*`, "COUNT", 200);
        cursor = reply[0];
        if (reply[1].length) await janitor.del(...reply[1]);
      } while (cursor !== "0");
      await janitor.quit();
    }
    console.log("✓ pg mirror: enqueue dedup anchored in agent_task_queue_mirror, final states (done/failed) persisted, redis never authoritative, terminal-stale reclaim guarded");
  } finally {
    await pgPersistenceService.closeForTests();
    delete process.env.AGENT_PG_URL;
    await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await closePool(adminPool);
  }
}

(async () => {
  await testFileQueue(); // 不依赖外部服务，始终执行
  await testRedisUnavailable(); // 不依赖外部服务，始终执行

  let redisReason = "no Redis available";
  const redisEnv = await ensureRedis({ onReason: (text) => {
    redisReason = text;
  } });
  if (!redisEnv) {
    console.log(`\ntest-agent-p5a-task-queue: redis sections UNVERIFIED (${redisReason})`);
    console.log("test-agent-p5a-task-queue: PASS (file + degradation sections)");
    process.exit(0);
  }
  console.log(`redis-test-env: ${redisEnv.owned ? `docker container ${redisEnv.containerName}` : "external AGENT_TEST_REDIS_URL"} (${redactUrl(redisEnv.url)})`);
  try {
    await testRedisQueue(redisEnv);

    let pgReason = "no PostgreSQL available";
    // migration 聚合含 0005（CREATE EXTENSION vector）→ 基线镜像 pgvector/pgvector:pg16。
    const pgEnv = await ensurePg({ image: "pgvector/pgvector:pg16", onReason: (text) => {
      pgReason = text;
    } });
    if (!pgEnv) {
      console.log(`test-agent-p5a-task-queue: pg-mirror section UNVERIFIED (${pgReason})`);
    } else {
      try {
        await testPgMirror(redisEnv, pgEnv);
      } finally {
        await pgEnv.cleanup();
      }
    }
  } finally {
    await redisEnv.cleanup();
  }
  console.log("\ntest-agent-p5a-task-queue: PASS");
  process.exit(0);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
