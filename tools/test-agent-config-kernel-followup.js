#!/usr/bin/env node
// P4a 独立审查跟进修复的契约锁定（d7288a87 之后）：
// 1. 请求作用域 runtimeMode 决定快照环境绑定（AGENTS.md：不得仅用全局
//    configuredMode 串环境；trial/dev 上被降级的请求必须绑定 public 快照）；
// 2. 快照钉住的版本文档不可读时，技能目录解析 fail closed（coded 错误），
//    不静默回落静态全量目录（已禁用技能复活 = 授权漂移），且失败不缓存；
// 3. 内核 root 遵守全仓 FOSU_DATA_DIR 约定（子进程模式验证）。
// P5a：require 期不再种子——先 await platformReady()；内核/目录解析均 async。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const MODE = process.env.CONFIG_KERNEL_FOLLOWUP_MODE || "parent";

function tempdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cfg-kernel-followup-${label}-`));
}

async function dataDirChild() {
  // 子进程：仅设 FOSU_DATA_DIR（不设内核专用路径），内核 root 必须落在
  // <FOSU_DATA_DIR>/ai/config-kernel，而不是开发者真实的 server/data。
  const dataDir = tempdir("datadir");
  process.env.FOSU_DATA_DIR = dataDir;
  delete process.env.FOSU_AGENT_CONFIG_KERNEL_PATH;
  const composition = require("../server/src/services/ai/platformComposition");
  await composition.platformReady();
  const diagnostics = await composition.getConfigKernel().diagnostics("public");
  assert.ok(String(diagnostics.configVersion || "").startsWith("cfg-public-"), "seed runs against the redirected data dir");
  assert.ok(
    fs.existsSync(path.join(dataDir, "ai", "config-kernel", "snapshots")),
    "kernel root must honor FOSU_DATA_DIR"
  );
  console.log("✓ kernel root honors FOSU_DATA_DIR (child)");
}

async function main() {
  const root = tempdir("root");
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = root;
  process.env.AI_RUNTIME_MODE = "trial";
  const composition = require("../server/src/services/ai/platformComposition");
  await composition.platformReady();

  // 1. 请求作用域环境解析：request.runtimeMode（bindRuntimeDecision 的授权感知
  // 决策，经 platformInput 传入）优先于全局 configuredMode。
  assert.strictEqual(composition.resolveSnapshotEnvironment({ runtimeMode: "public" }), "public");
  assert.strictEqual(composition.resolveSnapshotEnvironment({ runtimeMode: "trial" }), "trial");
  assert.strictEqual(composition.resolveSnapshotEnvironment({}), "trial", "missing request mode falls back to configuredMode");
  assert.strictEqual(composition.resolveSnapshotEnvironment(null), "trial");
  console.log("✓ snapshot environment prefers request-scoped runtimeMode over configuredMode");

  // 2a. 正常解析（public 环境种子目录）。
  const kernel = composition.getConfigKernel();
  const publicSnapshot = await kernel.getCurrentSnapshot("public");
  const catalog = await composition.resolveSkillCatalogForSnapshot(publicSnapshot);
  assert.ok(catalog.get("teaching_week"), "seed catalog resolves");
  console.log("✓ seed-bound catalog resolves against the current snapshot");

  // 2b. 腐蚀 trial 环境已发布版本文档（digest 失配）：必须 fail closed。
  // 用 trial 环境避免命中 2a 已缓存的 public 目录而掩盖解析路径。
  const trialSnapshot = await kernel.getCurrentSnapshot("trial");
  const trialPinned = trialSnapshot.artifacts["skill:fosu-campus"];
  assert.ok(trialPinned && Number(trialPinned.version) >= 1, "trial seed pinned in snapshot");
  const artifactFile = path.join(
    root, "artifacts", "skill", "fosu-campus", "trial", `v${trialPinned.version}.json`
  );
  const original = fs.readFileSync(artifactFile, "utf8");
  fs.writeFileSync(artifactFile, JSON.stringify({ tampered: true }));
  await assert.rejects(
    () => composition.resolveSkillCatalogForSnapshot(trialSnapshot),
    (error) => error && error.code === "DECISION_SKILL_CATALOG_UNREADABLE",
    "tampered published artifact must fail closed, not resurrect the static full catalog"
  );
  console.log("✓ tampered published artifact fails closed (no silent static-catalog resurrection)");

  // 2c. 失败结果不得缓存：修复存储后无需重启即可解析。
  fs.writeFileSync(artifactFile, original);
  const recovered = await composition.resolveSkillCatalogForSnapshot(trialSnapshot);
  assert.ok(recovered.get("teaching_week"), "failure must not be memoized; storage repair takes effect without restart");
  console.log("✓ unreadable-catalog failure is not memoized");

  // 3. FOSU_DATA_DIR 重定向（独立子进程，隔离单例的 require 时解析）。
  const child = spawnSync(process.execPath, [__filename], {
    env: Object.assign({}, process.env, { CONFIG_KERNEL_FOLLOWUP_MODE: "data-dir" }),
    encoding: "utf8",
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  console.log("✓ FOSU_DATA_DIR redirect verified in child process");

  console.log("\ntest-agent-config-kernel-followup: PASS");
}

if (MODE === "data-dir") {
  dataDirChild().then(() => process.exit(0), (error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
