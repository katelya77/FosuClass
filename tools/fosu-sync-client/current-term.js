"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildSyncPlan, printablePlan } = require("../../shared/syncPlan");
const { DEFAULT_CURRENT_TERM, loadTermConfig } = require("../../shared/termConfig");
const { prepareDirectNetworkEnvironment } = require("./syncEnv");

function parseArgs(argv) {
  const params = {};
  (Array.isArray(argv) ? argv : []).forEach((arg) => {
    const match = String(arg).match(/^--([^=]+)(?:=(.*))?$/);
    if (match) params[match[1]] = match[2] === undefined ? true : match[2];
  });
  return params;
}

function bool(value) {
  return value === true || value === "true" || value === "1";
}

function statePath(root, term) {
  return path.join(root, "tools", "fosu-sync-client", ".cache", term, "current-term-state.json");
}

function readState(root, term) {
  try { return JSON.parse(fs.readFileSync(statePath(root, term), "utf8")); } catch (error) { return null; }
}

function latestProgressRunId(root, term) {
  const progressDir = path.join(root, "tools", "fosu-sync-client", ".cache", term, "progress");
  let candidates = [];
  try {
    candidates = fs.readdirSync(progressDir)
      .filter((name) => /^class-.+\.json$/.test(name) && !name.endsWith(".classSchedules.json"))
      .map((name) => ({
        name,
        mtimeMs: fs.statSync(path.join(progressDir, name)).mtimeMs,
      }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch (error) {
    return "";
  }
  return candidates.length ? candidates[0].name.slice("class-".length, -".json".length) : "";
}

function writeState(root, term, state) {
  const target = statePath(root, term);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function buildCurrentTermInvocation(argv, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, "../.."));
  const env = options.env || process.env;
  const params = parseArgs(argv);
  const term = String(params.term || env.FOSU_CURRENT_TERM || DEFAULT_CURRENT_TERM);
  const config = loadTermConfig(term, { root });
  const resume = bool(params.resume);
  const previous = resume ? readState(root, term) : null;
  const resumableRunId = resume && latestProgressRunId(root, term);
  if (resume && !resumableRunId) {
    const error = new Error("CURRENT_TERM_RESUME_STATE_MISSING");
    error.code = "CURRENT_TERM_RESUME_STATE_MISSING";
    throw error;
  }
  // A resumed current-term run keeps the canonical new-term scope set.  The
  // generic "resume" profile has no implicit scopes and is therefore not an
  // acceptable source of truth for this one-click pipeline.
  const action = "new-term";
  const plan = buildSyncPlan(action, {
    term,
    "term-start-date": config.termStartDate,
    "total-weeks": String(config.totalWeeks),
    "week-start": config.weekStart,
    "catalog-policy": resume ? "reuse-validated" : "network-only",
    "schedule-policy": "network-only",
    "progress-policy": resume ? "resume" : "ignore",
    "negative-cache-policy": "ignore",
    "allow-derived": true,
    "run-id": resumableRunId || previous && previous.runId || params["run-id"],
    activate: bool(params.activate),
    "no-upload": bool(params["no-upload"]),
    "no-publish": bool(params["no-publish"]),
  }, env);
  const args = [action,
    `--term=${term}`,
    `--term-start-date=${config.termStartDate}`,
    `--total-weeks=${config.totalWeeks}`,
    `--week-start=${config.weekStart}`,
    `--run-id=${plan.runId}`,
    `--catalog-policy=${plan.catalogPolicy}`,
    `--schedule-policy=${plan.schedulePolicy}`,
    `--progress-policy=${plan.progressPolicy}`,
    "--negative-cache-policy=ignore",
    "--allow-derived",
  ];
  if (plan.activate) args.push("--activate");
  if (resume) args.push("--resume");
  if (!plan.upload) args.push("--no-upload");
  if (!plan.buildRelease) args.push("--no-publish");
  const runtimeEnv = Object.assign({}, env, {
    SYNC_LOCAL_STAGING_ONLY: env.ADMIN_API_TOKEN ? String(env.SYNC_LOCAL_STAGING_ONLY || "false") : "true",
  });
  const networkIsolation = prepareDirectNetworkEnvironment(runtimeEnv);
  return { args, config, plan, root, resume, runtimeEnv, networkIsolation };
}

function buildPostActivateMirrorInvocation(invocation) {
  if (!invocation || !invocation.plan || invocation.plan.activate !== true) return null;
  return {
    command: process.execPath,
    args: [
      path.join(invocation.root, "tools", "fosu-publisher", "publish.js"),
      "--mode=mirror-only",
      `--term=${invocation.config.term}`,
    ],
  };
}

function main(argv = process.argv.slice(2)) {
  const invocation = buildCurrentTermInvocation(argv);
  const params = parseArgs(argv);
  const state = {
    schema: "fosuclass-current-term-run/v1",
    term: invocation.config.term,
    configFile: path.relative(invocation.root, invocation.config.filePath).replace(/\\/g, "/"),
    calendarSource: invocation.config.teachingCalendar && invocation.config.teachingCalendar.source,
    calendarStatus: invocation.config.teachingCalendar && invocation.config.teachingCalendar.sourceStatus,
    runId: invocation.plan.runId,
    status: "STARTED",
    updatedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify({
    phase: "CURRENT_TERM_PLAN",
    config: {
      term: invocation.config.term,
      termStartDate: invocation.config.termStartDate,
      totalWeeks: invocation.config.totalWeeks,
      weekStart: invocation.config.weekStart,
      calendarStatus: state.calendarStatus,
    },
    plan: printablePlan(invocation.plan),
  }, null, 2));
  if (bool(params["plan-only"])) return 0;
  writeState(invocation.root, invocation.config.term, state);
  const result = spawnSync(process.execPath, [path.join(__dirname, "sync.js"), ...invocation.args], {
    cwd: invocation.root,
    env: invocation.runtimeEnv,
    stdio: "inherit",
  });
  let status = Number.isInteger(result.status) ? result.status : 1;
  let mirrorStatus = "NOT_REQUIRED";
  if (status === 0) {
    const mirrorInvocation = buildPostActivateMirrorInvocation(invocation);
    if (mirrorInvocation) {
      mirrorStatus = "RUNNING";
      const mirror = spawnSync(mirrorInvocation.command, mirrorInvocation.args, {
        cwd: invocation.root,
        env: invocation.runtimeEnv,
        stdio: "inherit",
      });
      const mirrorExit = Number.isInteger(mirror.status) ? mirror.status : 1;
      mirrorStatus = mirrorExit === 0 ? "DUAL_SOURCE_VERIFIED" : "FAILED";
      if (mirrorExit !== 0) status = mirrorExit;
    }
  }
  let needsLogin = false;
  if (status !== 0 && mirrorStatus !== "FAILED") {
    const verify = spawnSync(process.execPath, [path.join(__dirname, "verify-session.js")], {
      cwd: invocation.root,
      env: invocation.runtimeEnv,
      encoding: "utf8",
      timeout: 60000,
    });
    needsLogin = verify.status !== 0;
  }
  writeState(invocation.root, invocation.config.term, Object.assign({}, state, {
    status: status === 0
      ? (invocation.plan.activate ? "ACTIVE_DUAL_SOURCE_READY" : "STAGING_READY")
      : (needsLogin ? "USER_ACTION_REQUIRED" : "PARTIAL"),
    mirrorStatus,
    userAction: needsLogin
      ? "npm run login"
      : (mirrorStatus === "FAILED" ? `npm run sync:publish:mirror -- --term=${invocation.config.term}` : ""),
    resumeCommand: status === 0 || mirrorStatus === "FAILED" ? "" : "npm run sync:current-term -- --resume",
    updatedAt: new Date().toISOString(),
  }));
  if (status !== 0) {
    if (needsLogin) console.error("USER_ACTION_REQUIRED: npm run login");
    else if (mirrorStatus === "FAILED") console.error(`CLOUDBASE_MIRROR_REQUIRED: npm run sync:publish:mirror -- --term=${invocation.config.term}`);
    else console.error("SYNC_PARTIAL: reusable run cache was preserved");
    if (mirrorStatus !== "FAILED") console.error("RESUME: npm run sync:current-term -- --resume");
  }
  return status;
}

if (require.main === module) process.exitCode = main();
module.exports = { buildCurrentTermInvocation, buildPostActivateMirrorInvocation, latestProgressRunId, main, parseArgs, readState, statePath };
