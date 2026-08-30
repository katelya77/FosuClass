"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const appConfigService = require("./appConfigService");
const { buildDeployment } = require("../content/dailyKnowledgeCloudbaseData");

const ROOT = path.resolve(__dirname, "../../..");
const SYNC_SCRIPT = path.join(ROOT, "tools/cloudbase/sync-daily-knowledge.js");
const ENV_ID = "cloud1-d3g17rpe7566d3d5c";

function getActiveManaged(now = new Date()) {
  const state = appConfigService.getDailyKnowledgeAdminState(now);
  const time = now.getTime();
  const managed = (state.managed || []).filter((item) => {
    if (!item || item.enabled !== true) return false;
    const start = item.startAt ? new Date(item.startAt).getTime() : NaN;
    const end = item.endAt ? new Date(item.endAt).getTime() : NaN;
    return !(Number.isFinite(start) && time < start) && !(Number.isFinite(end) && time > end);
  }).sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
  return { state, managed };
}

function getPlan(now = new Date()) {
  const { state, managed } = getActiveManaged(now);
  const deployment = buildDeployment({ managed, builtin: state.builtin || [], policy: state.policy }, now);
  const runtimeReady = fs.existsSync(SYNC_SCRIPT);
  return {
    envId: ENV_ID,
    registryCollection: deployment.registryCollection,
    contentCollection: deployment.collectionName,
    contentVersion: deployment.contentVersion,
    count: deployment.count,
    managedCount: deployment.managedCount,
    builtinCount: deployment.builtinCount,
    rotationCount: deployment.rotationCount,
    enabled: deployment.enabled,
    strategy: deployment.strategy,
    source: deployment.source,
    permission: "READONLY",
    keepVersions: 2,
    runtimeReady,
    syncEnabled: runtimeReady && process.env.FOSU_DAILY_KNOWLEDGE_CLOUDBASE_SYNC_ENABLED === "true",
    command: "npm run cloudbase:daily-knowledge:deploy",
    verifyCommand: "npm run cloudbase:daily-knowledge:verify",
  };
}

function runScript(args) {
  const result = spawnSync(process.execPath, [SYNC_SCRIPT].concat(args), {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = new Error("CloudBase 每日知识任务未完成");
    error.code = "DAILY_KNOWLEDGE_CLOUDBASE_TASK_FAILED";
    error.status = result.status;
    error.stderr = String(result.stderr || "").slice(-4000);
    throw error;
  }
  try {
    return JSON.parse(String(result.stdout || "{}"));
  } catch (error) {
    const wrapped = new Error("CloudBase 每日知识任务返回格式异常");
    wrapped.code = "DAILY_KNOWLEDGE_CLOUDBASE_INVALID_RESULT";
    throw wrapped;
  }
}

function verify() {
  const plan = getPlan();
  if (!plan.runtimeReady) {
    return Object.assign({}, plan, {
      verification: {
        ok: false,
        code: "DAILY_KNOWLEDGE_CLOUDBASE_TOOL_UNAVAILABLE",
        expectedCount: plan.count,
        count: 0,
      },
    });
  }
  return runScript(["--verify", `--env=${ENV_ID}`]);
}

function sync() {
  const plan = getPlan();
  if (!plan.syncEnabled) {
    return Object.assign({}, plan, {
      status: "pending",
      code: "DAILY_KNOWLEDGE_CLOUDBASE_SYNC_NOT_ENABLED",
      message: "服务器未启用 CloudBase 自动写入；迁移命令已准备完成。",
    });
  }
  return runScript([
    "--execute",
    `--env=${ENV_ID}`,
    "--confirm=publish-fosu-daily-knowledge",
  ]);
}

module.exports = { ENV_ID, getPlan, sync, verify };
