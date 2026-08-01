#!/usr/bin/env node
/**
 * standalone compose 全栈 18 条验收（本地 + CI 双用途，原提示词十二）。
 *
 * 编排：buildx build → compose up（PG+Redis+migrate+server+worker）
 * → HTTP 逐项验证 → 重启持久 → rollback → fosu-campus 接缝 → down -v 清理。
 *
 * 运行：node tools/standalone-compose-smoke.js（仓库根目录）。环境变量：
 *   SMOKE_IMAGE=name:tag  被测镜像（默认 fosu-agent-platform:local-smoke）
 *   SMOKE_SKIP_BUILD=1    跳过构建（要求 SMOKE_IMAGE 已存在，CI 各架构本地镜像用）
 *   SMOKE_PROJECT=name    compose project 名（默认 agent-standalone-smoke）
 *   SMOKE_PORT=18080      宿主机端口
 *   SMOKE_KEEP=1          结束后不 down -v（调试用）
 *
 * 纪律：逐项打印真实观测值；任何 FAIL 退出码 1；密钥只写入 mkdtemp 目录
 *（不落仓库，仓库 secret 扫描会命中 .env 文本），不回显完整值；
 * transcript 落 .tmp/standalone-compose-smoke-transcript.log 供证据引用。
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
// env/override 放 mkdtemp：随机密钥不落仓库目录（仓库 secret 扫描会命中 .env 文本）。
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-smoke-"));
const ENV_FILE = path.join(WORK_DIR, "smoke.env");
const OVERRIDE_FILE = path.join(WORK_DIR, "smoke-override.yml");
const FOSU_OVERRIDE_FILE = path.join(WORK_DIR, "smoke-fosu.yml");
const TRANSCRIPT = path.join(ROOT, ".tmp/standalone-compose-smoke-transcript.log");

const PROJECT = process.env.SMOKE_PROJECT || "agent-standalone-smoke";
const IMAGE = process.env.SMOKE_IMAGE || "fosu-agent-platform:local-smoke";
const IMAGE_SEP = IMAGE.lastIndexOf(":");
const IMAGE_NAME = IMAGE_SEP > 0 ? IMAGE.slice(0, IMAGE_SEP) : IMAGE;
const IMAGE_TAG = IMAGE_SEP > 0 ? IMAGE.slice(IMAGE_SEP + 1) : "latest";
const HOST_PORT = Number(process.env.SMOKE_PORT || 18080);
const BASE = `http://127.0.0.1:${HOST_PORT}`;

const PG_PASSWORD = crypto.randomBytes(24).toString("hex");
const REDIS_PASSWORD = crypto.randomBytes(24).toString("hex");
const ADMIN_TOKEN = crypto.randomBytes(24).toString("hex");
const READ_TOKEN = crypto.randomBytes(24).toString("hex");

const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };
const readOnly = { authorization: `Bearer ${READ_TOKEN}` };

const results = [];
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  fs.appendFileSync(TRANSCRIPT, `${stamped}\n`);
}
function record(item, ok, detail) {
  results.push({ item, ok, detail });
  log(`[SMOKE ${item}] ${ok ? "PASS" : "FAIL"} — ${detail}`);
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    cwd: ROOT, encoding: "utf8", stdio: options.stdio || ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}
function composeFiles(extra) {
  const files = ["compose", "-p", PROJECT,
    "-f", "deploy/standalone/docker-compose.yml",
    "-f", OVERRIDE_FILE,
    "--env-file", ENV_FILE];
  if (extra) files.push("-f", extra);
  return files;
}
function compose(args, extra) {
  return docker([...composeFiles(extra), ...args]);
}
function inspect(format, name) {
  return docker(["inspect", "--format", format, name]).trim();
}

async function httpJson(method, pathname, body, headers) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: Object.assign({ "content-type": "application/json", accept: "application/json" }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, json, text };
}
const get = (pathname, headers) => httpJson("GET", pathname, undefined, headers);

async function waitFor(label, fn, deadlineMs, intervalMs = 1000) {
  const deadline = Date.now() + deadlineMs;
  let last = "";
  for (;;) {
    try {
      const value = await fn();
      if (value && value.ok) return value.value;
      last = value && value.error ? String(value.error) : JSON.stringify(value);
    } catch (error) {
      last = String((error && error.message) || error);
    }
    if (Date.now() > deadline) throw new Error(`${label} 超时: ${last}`);
    await sleep(intervalMs);
  }
}

function gitSha() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

async function main() {
  fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
  fs.writeFileSync(TRANSCRIPT, "");
  log(`standalone compose smoke 开始（project=${PROJECT}, image=${IMAGE}, port=${HOST_PORT}）`);

  // ---- 构建（本地默认 amd64；CI 各架构经 build-push-action 产出本地镜像后以 SMOKE_SKIP_BUILD=1 调用）----
  if (process.env.SMOKE_SKIP_BUILD === "1") {
    log(`跳过构建（SMOKE_SKIP_BUILD=1），要求镜像已存在: ${IMAGE}`);
  } else {
    log("构建 standalone 镜像（buildx, linux/amd64, --load）…");
    execFileSync("docker", ["buildx", "build", "--load", "--platform", "linux/amd64",
      "-f", "server/Dockerfile", "--target", "standalone",
      "--build-arg", `GIT_REVISION=${gitSha()}`,
      "--build-arg", `BUILD_CREATED=${new Date().toISOString()}`,
      "--build-arg", `IMAGE_VERSION=${gitSha().slice(0, 8)}`,
      "-t", IMAGE, "."], { cwd: ROOT, stdio: "inherit", maxBuffer: 64 * 1024 * 1024 });
    log("镜像构建完成");
  }
  const imageId = docker(["image", "inspect", "--format", "{{.Id}}", IMAGE]).trim();
  log(`镜像 ID: ${imageId}`);

  // ---- env / override 文件 ----
  fs.writeFileSync(ENV_FILE, [
    `AGENT_PLATFORM_IMAGE=${IMAGE_NAME}`,
    `AGENT_PLATFORM_VERSION=${IMAGE_TAG}`,
    `AGENT_PLATFORM_GIT_REVISION=${gitSha()}`,
    `AGENT_PLATFORM_BUILD_CREATED=${new Date().toISOString()}`,
    "AGENT_PG_USER=agent",
    `AGENT_PG_PASSWORD=${PG_PASSWORD}`,
    "AGENT_PG_DATABASE=agent_platform",
    "AGENT_PG_URL=",
    "AGENT_PG_SSL=",
    `AGENT_REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0`,
    `AGENT_REDIS_PASSWORD=${REDIS_PASSWORD}`,
    "FOSU_AGENT_REPOSITORY_BACKEND=postgres",
    "AGENT_PLATFORM_HOST_BIND=127.0.0.1",
    `AGENT_PLATFORM_HOST_PORT=${HOST_PORT}`,
    `AGENT_PLATFORM_ADMIN_TOKEN=${ADMIN_TOKEN}`,
    `AGENT_PLATFORM_SERVICE_TOKENS='[{"name":"smoke-read","token":"${READ_TOKEN}","scopes":["agent-config:read"]}]'`,
    "AGENT_PLATFORM_RUNTIME_MODE=public",
    "AGENT_PLATFORM_PROVIDERS=",
    "DEEPSEEK_API_KEY=",
    "",
  ].join("\n"));
  fs.writeFileSync(OVERRIDE_FILE, [
    `# smoke 隔离：容器命名 ${PROJECT}-*（卷经 -p 前缀自动隔离）`,
    "services:",
    `  postgres: { container_name: ${PROJECT}-postgres }`,
    `  redis:    { container_name: ${PROJECT}-redis }`,
    `  migrate:  { container_name: ${PROJECT}-migrate }`,
    `  server:   { container_name: ${PROJECT}-server }`,
    `  worker:   { container_name: ${PROJECT}-worker }`,
    "",
  ].join("\n"));
  fs.writeFileSync(FOSU_OVERRIDE_FILE, [
    "# smoke item 18：请求启用 fosu-campus（当前仅验证装配接缝语义，插件注入为后续阶段）",
    "services:",
    "  server:",
    "    environment:",
    "      AGENT_PLATFORM_ENABLE_FOSU: \"1\"",
    "",
  ].join("\n"));

  let publishedConfigVersion = null;
  let timeRunId = null;
  let timeRunPollToken = null;
  const runsSeen = [];

  try {
    // ---- up ----
    log("compose up -d（postgres/redis/migrate/server/worker）…");
    compose(["up", "-d"]);

    // [1] PostgreSQL 和 Redis healthy
    await waitFor("postgres healthy", () => {
      const status = inspect("{{.State.Health.Status}}", `${PROJECT}-postgres`);
      return status === "healthy" ? { ok: true, value: status } : { error: status };
    }, 120000);
    await waitFor("redis healthy", () => {
      const status = inspect("{{.State.Health.Status}}", `${PROJECT}-redis`);
      return status === "healthy" ? { ok: true, value: status } : { error: status };
    }, 120000);
    record("1/18", true, "postgres 与 redis 容器 Health.Status=healthy");

    // [2] migrations 完成
    await waitFor("migrate exit 0", () => {
      const code = inspect("{{.State.ExitCode}}", `${PROJECT}-migrate`);
      return code === "0" ? { ok: true, value: code } : { error: `exit=${code}` };
    }, 180000);
    // server ready（readiness 含 migration 项）
    await waitFor("server /health/ready 200", async () => {
      const res = await get("/health/ready");
      return res.status === 200 ? { ok: true, value: res.json } : { error: `HTTP ${res.status}` };
    }, 180000, 2000);
    const ready = (await get("/health/ready")).json;
    record("2/18", ready.items && ready.items.migration && ready.items.migration.status === "ok",
      `migrate 容器 exit 0；readiness migration=${ready.items && ready.items.migration && ready.items.migration.status}`);

    // readiness 九项细分（附证，属 item 2/16 的口径基础）
    const readinessItems = ready.items || {};
    const readinessSummary = Object.keys(readinessItems).sort()
      .map((k) => `${k}=${readinessItems[k].status}`).join(",");
    log(`readiness 细分: ${readinessSummary}`);
    log(`capabilities: ${JSON.stringify(ready.capabilities)}`);

    // [3] Admin 可访问
    const adminPage = await get("/admin/agent-platform/");
    const runtimeConfig = await get("/admin/agent-platform/runtime-config.js");
    record("3/18", adminPage.status === 200 && runtimeConfig.status === 200,
      `GET /admin/agent-platform/ → HTTP ${adminPage.status}；runtime-config.js → HTTP ${runtimeConfig.status}`);

    // [4] 声明式 Skill 草稿（先查版本历史 → 取当前发布版本 payload → 修改 → PUT draft）
    const versionsRes = await get("/api/admin/agent-platform/config/versions?env=public&domain=skill&artifactId=standalone-core", admin);
    if (versionsRes.status !== 200) throw new Error(`读取 skill versions 失败: ${versionsRes.text}`);
    const history = (versionsRes.json && versionsRes.json.versions) || [];
    const currentVersion = history.reduce((max, entry) => Math.max(max, Number(entry && entry.version) || 0), 0);
    if (!currentVersion) throw new Error(`skill 无已发布版本: ${versionsRes.text}`);
    const currentSkill = await get(`/api/admin/agent-platform/config/artifact?env=public&domain=skill&artifactId=standalone-core&version=${currentVersion}`, admin);
    if (currentSkill.status !== 200) throw new Error(`读取 skill artifact 失败: ${currentSkill.text}`);
    const skillPayload = (currentSkill.json.artifact && (currentSkill.json.artifact.payload || currentSkill.json.artifact));
    skillPayload.skills = skillPayload.skills.map((skill) => (skill.id === "platform.time"
      ? Object.assign({}, skill, { description: "Standalone compose smoke acceptance: report the server clock." })
      : skill));
    const putDraft = await httpJson("PUT", "/api/admin/agent-platform/config/draft",
      { environment: "public", domain: "skill", artifactId: "standalone-core", payload: skillPayload }, admin);
    record("4/18", putDraft.status === 200, `当前发布 v${currentVersion} → 修改描述 → PUT config/draft(skill) → HTTP ${putDraft.status}`);

    // [5] validate/test/publish（skill v2；tool v2；mcp；另证 read-only token 写操作 403）
    async function publishDomain(domain, payload) {
      if (payload) {
        const put = await httpJson("PUT", "/api/admin/agent-platform/config/draft",
          { environment: "public", domain, artifactId: "standalone-core", payload }, admin);
        if (put.status !== 200) throw new Error(`${domain} putDraft: ${put.text}`);
      }
      const validated = await httpJson("POST", "/api/admin/agent-platform/config/validate",
        { environment: "public", domain, artifactId: "standalone-core" }, admin);
      if (!(validated.status === 200 && validated.json.validation && validated.json.validation.ok === true)) {
        throw new Error(`${domain} validate: ${validated.text}`);
      }
      const tested = await httpJson("POST", "/api/admin/agent-platform/config/test",
        { environment: "public", domain, artifactId: "standalone-core" }, admin);
      if (!(tested.status === 200 && tested.json.test && tested.json.test.ok === true)) {
        throw new Error(`${domain} test: ${tested.text}`);
      }
      const published = await httpJson("POST", "/api/admin/agent-platform/config/publish",
        { environment: "public", domain, artifactId: "standalone-core" }, admin);
      if (published.status !== 200) throw new Error(`${domain} publish: ${published.text}`);
      return published.json.published;
    }
    const forbidden = await httpJson("POST", "/api/admin/agent-platform/config/publish",
      { environment: "public", domain: "skill", artifactId: "standalone-core" }, readOnly);
    const publishedSkill = await publishDomain("skill");
    const publishedTool = await publishDomain("tool", { tools: [{ id: "platform.clock", enabled: true }] });
    const publishedMcp = await publishDomain("mcp", { servers: [] });
    record("5/18", Boolean(publishedSkill && publishedSkill.version === 2 && publishedTool && publishedTool.version === 2 && publishedMcp && forbidden.status === 403),
      `skill v${publishedSkill && publishedSkill.version}/tool v${publishedTool && publishedTool.version}/mcp v${publishedMcp && publishedMcp.version} 经 validate→test→publish；read-only token 发布 → HTTP ${forbidden.status}`);

    // [11] 创建 RAG 文档并发布（rag v2）
    const publishedKb = await publishDomain("rag", {
      kbId: "platform-example",
      documents: [{
        docId: "standalone-smoke-acceptance",
        title: "Standalone compose smoke 验收文档",
        kind: "note",
        tags: ["standalone", "smoke"],
        text: "Standalone 平台包含 server、worker、admin、migrate 四个角色。配置发布采用草稿、校验、测试、发布四段流程，回滚把发布指针切回历史版本。",
      }],
    });
    publishedConfigVersion = publishedKb && publishedKb.configVersion;
    record("11/18", Boolean(publishedKb && publishedKb.version === 2 && publishedConfigVersion),
      `rag v${publishedKb && publishedKb.version}（docId=standalone-smoke-acceptance），publishedConfigVersion=${publishedConfigVersion}`);

    // Run 工具函数
    async function createRun(message) {
      const created = await httpJson("POST", "/api/agent/runs", {
        message,
        requestId: `standalone-smoke-${crypto.randomBytes(4).toString("hex")}`,
        conversationId: "standalone-smoke-conv",
        context: {},
      });
      if (created.status !== 202) throw new Error(`createRun: HTTP ${created.status} ${created.text}`);
      const runId = created.json.runId;
      const pollToken = created.json.pollToken;
      const deadline = Date.now() + 60000;
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const view = await get(`/api/agent/runs/${encodeURIComponent(runId)}?pollToken=${encodeURIComponent(pollToken)}`);
        if (view.status !== 200) throw new Error(`getRun: HTTP ${view.status} ${view.text}`);
        if (["completed", "degraded", "failed", "cancelled"].includes(view.json.status)) {
          const run = { runId, pollToken, view: view.json };
          runsSeen.push(run);
          return run;
        }
        if (Date.now() > deadline) throw new Error(`run 未收敛: ${JSON.stringify(view.json).slice(0, 300)}`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(500);
      }
    }

    // [6][7][8][9][10] 创建 Run → 绑定 configVersion → 只读示例 Skill → RunEvent → 结果可恢复
    const timeRun = await createRun("现在几点了？");
    timeRunId = timeRun.runId;
    timeRunPollToken = timeRun.pollToken;
    const timeResult = timeRun.view.result || {};
    record("6/18", timeRun.view.status === "completed", `POST /api/agent/runs → 202，run 收敛 status=${timeRun.view.status}`);
    record("7/18", timeResult.platformTrace && timeResult.platformTrace.configVersion === publishedConfigVersion,
      `platformTrace.configVersion=${timeResult.platformTrace && timeResult.platformTrace.configVersion}（期望 ${publishedConfigVersion}）`);
    record("8/18", String(timeResult.answer || "").includes("UTC") && timeResult.ui && Array.isArray(timeResult.ui.blocks) && timeResult.ui.blocks.length > 0,
      `内置只读示例 Skill(platform.time) 应答含 UTC；UI blocks=${timeResult.ui && timeResult.ui.blocks && timeResult.ui.blocks.length} 个`);
    const eventTypes = (timeRun.view.events || []).map((event) => event.type);
    const needEvents = ["run.accepted", "runtime.entered", "stage.started", "stage.completed", "runtime.completed", "run.completed"];
    record("9/18", needEvents.every((type) => eventTypes.includes(type)),
      `RunEvent 链 ${eventTypes.join(" → ")}`);
    const recover = await get(`/api/agent/runs/${encodeURIComponent(timeRunId)}?pollToken=${encodeURIComponent(timeRunPollToken)}`);
    record("10/18", recover.status === 200 && recover.json.status === "completed" && Boolean(recover.json.result),
      `终态后 GET run → HTTP ${recover.status}，result 可读`);

    // [12][13] RAG 查询真实引用 + worker 异步索引完成
    let kbRun = null;
    const kbDeadline = Date.now() + 90000;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      kbRun = await createRun("配置发布流程是怎样的？");
      const citations = (kbRun.view.result && kbRun.view.result.citations) || [];
      if (citations.some((item) => item.docId === "standalone-smoke-acceptance")) break;
      if (Date.now() > kbDeadline) throw new Error("RAG 查询 90s 内未返回真实引用");
      // eslint-disable-next-line no-await-in-loop
      await sleep(2000);
    }
    const kbCitations = (kbRun.view.result && kbRun.view.result.citations) || [];
    record("12/18", kbCitations.some((item) => item.docId === "standalone-smoke-acceptance"),
      `RAG 查询引用 ${JSON.stringify(kbCitations.map((c) => c.docId))}`);
    const workerHealthFinal = await waitFor("worker healthy", () => {
      const status = inspect("{{.State.Health.Status}}", `${PROJECT}-worker`);
      return status === "healthy" ? { ok: true, value: status } : { error: status };
    }, 120000, 2000);
    const workerLogs = compose(["logs", "--no-color", "--tail", "200", "worker"]);
    const indexLogHit = /rag|index/i.test(workerLogs);
    record("13/18", workerHealthFinal === "healthy",
      `worker healthy=true；引用出现即索引完成（索引仅经 worker 队列异步构建）；附证：worker 日志含 rag/index 记录=${indexLogHit}`);

    // [16] public 外部 Provider 调用为 0（聚合所有 Run + readiness provider 项）
    const providerZero = runsSeen.every((run) => run.view.result
      && run.view.result.externalProviderUsed === false && run.view.result.provider === "");
    const providerItem = readinessItems.provider || {};
    record("16/18", providerZero && providerItem.status === "not_ready" && providerItem.reason === "PROVIDER_NOT_CONFIGURED" && providerItem.blocking === false,
      `${runsSeen.length} 个 Run externalProviderUsed=false/provider=""；readiness provider=${providerItem.status}(${providerItem.reason},blocking=${providerItem.blocking})`);

    // [17] 未启用 fosu-campus：接缝 501 NOT_ENABLED + 全流程无插件运行
    const seamOff = await get("/api/agent/integrations/fosu-campus");
    record("17/18", seamOff.status === 501 && seamOff.json && seamOff.json.code === "FOSU_CAMPUS_NOT_ENABLED",
      `GET integrations/fosu-campus → HTTP ${seamOff.status} code=${seamOff.json && seamOff.json.code}；全部检查在无校园插件下完成`);

    // [14] 重启后数据仍存在
    log("compose restart server worker …");
    compose(["restart", "server", "worker"]);
    await waitFor("server ready after restart", async () => {
      const res = await get("/health/ready");
      return res.status === 200 ? { ok: true, value: true } : { error: `HTTP ${res.status}` };
    }, 180000, 2000);
    await waitFor("worker healthy after restart", () => {
      const status = inspect("{{.State.Health.Status}}", `${PROJECT}-worker`);
      return status === "healthy" ? { ok: true, value: status } : { error: status };
    }, 180000, 2000);
    const snapshotAfter = await get("/api/admin/agent-platform/config/snapshot?env=public", admin);
    const sameVersion = snapshotAfter.status === 200 && snapshotAfter.json.snapshot
      && snapshotAfter.json.snapshot.configVersion === publishedConfigVersion;
    const oldRun = await get(`/api/agent/runs/${encodeURIComponent(timeRunId)}?pollToken=${encodeURIComponent(timeRunPollToken)}`);
    const oldRunOk = oldRun.status === 200 && oldRun.json.status === "completed" && Boolean(oldRun.json.result);
    let kbStill = null;
    const kbStillDeadline = Date.now() + 60000;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      kbStill = await createRun("配置发布流程是怎样的？");
      const citations = (kbStill.view.result && kbStill.view.result.citations) || [];
      if (citations.some((item) => item.docId === "standalone-smoke-acceptance")) break;
      if (Date.now() > kbStillDeadline) throw new Error("重启后 RAG 引用丢失");
      // eslint-disable-next-line no-await-in-loop
      await sleep(1500);
    }
    record("14/18", Boolean(sameVersion && oldRunOk),
      `重启后 configVersion=${snapshotAfter.json.snapshot && snapshotAfter.json.snapshot.configVersion}（不变=${sameVersion}）；历史 Run 可读=${oldRunOk}；RAG 引用仍在`);

    // [15] rollback 后新 Run 用旧版本
    const rollback = await httpJson("POST", "/api/admin/agent-platform/config/rollback",
      { environment: "public", domain: "skill", artifactId: "standalone-core", toVersion: 1 }, admin);
    const rolledBackConfigVersion = rollback.json && rollback.json.rolledBack && rollback.json.rolledBack.configVersion;
    const snapshotRolled = await get("/api/admin/agent-platform/config/snapshot?env=public", admin);
    const skillBackToV1 = snapshotRolled.json.snapshot
      && snapshotRolled.json.snapshot.artifacts["skill:standalone-core"]
      && snapshotRolled.json.snapshot.artifacts["skill:standalone-core"].version === 1;
    const rerun = await createRun("现在几点了？");
    const rerunBindsOld = rerun.view.result && rerun.view.result.platformTrace
      && rerun.view.result.platformTrace.configVersion === rolledBackConfigVersion;
    record("15/18", Boolean(rollback.status === 200 && skillBackToV1 && rerunBindsOld && rolledBackConfigVersion !== publishedConfigVersion),
      `rollback skill→v1（configVersion ${publishedConfigVersion}→${rolledBackConfigVersion}）；新 Run 绑定 ${rerun.view.result && rerun.view.result.platformTrace && rerun.view.result.platformTrace.configVersion}`);

    // [18] 请求启用 fosu-campus → 501 ASSEMBLY_NOT_IMPLEMENTED；随后还原
    log("应用 fosu 启用 override（AGENT_PLATFORM_ENABLE_FOSU=1）并重建 server …");
    compose(["up", "-d", "server"], FOSU_OVERRIDE_FILE);
    await waitFor("server ready (fosu override)", async () => {
      const res = await get("/health/ready");
      return res.status === 200 ? { ok: true, value: true } : { error: `HTTP ${res.status}` };
    }, 180000, 2000);
    const seamOn = await get("/api/agent/integrations/fosu-campus");
    record("18/18", seamOn.status === 501 && seamOn.json && seamOn.json.code === "FOSU_CAMPUS_ASSEMBLY_NOT_IMPLEMENTED",
      `启用请求下 seam → HTTP ${seamOn.status} code=${seamOn.json && seamOn.json.code}（当前仅验证装配接缝语义，插件注入为后续阶段）`);
    log("还原 fosu override …");
    compose(["up", "-d", "server"]);
    await waitFor("server ready (revert)", async () => {
      const res = await get("/health/ready");
      return res.status === 200 ? { ok: true, value: true } : { error: `HTTP ${res.status}` };
    }, 180000, 2000);
    const seamReverted = await get("/api/agent/integrations/fosu-campus");
    log(`还原后 seam code=${seamReverted.json && seamReverted.json.code}`);
  } finally {
    if (process.env.SMOKE_KEEP === "1") {
      log("SMOKE_KEEP=1：保留容器与卷");
    } else {
      log("compose down -v 清理 …");
      try { compose(["down", "-v"]); } catch (error) { log(`down 清理异常: ${String(error && error.message || error)}`); }
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  log(`SMOKE 汇总: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    failed.forEach((entry) => log(`FAIL ${entry.item}: ${entry.detail}`));
    console.error(`STANDALONE-SMOKE FAIL (${failed.length})`);
    process.exit(1);
  }
  log("STANDALONE-SMOKE PASS (18/18)");
  process.exit(0);
}

main().catch((error) => {
  log(`SMOKE 编排异常: ${String((error && error.stack) || error)}`);
  try {
    if (process.env.SMOKE_KEEP !== "1") {
      execFileSync("docker", [...composeFiles(), "down", "-v"], { cwd: ROOT, stdio: "ignore" });
    }
  } catch { /* best effort */ }
  console.error("STANDALONE-SMOKE ERROR");
  process.exit(1);
});
