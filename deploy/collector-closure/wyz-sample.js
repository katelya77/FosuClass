#!/usr/bin/env node
"use strict";
// This is a one-shot wrapper around the installed CLI, never another collector or Broker.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const contract = require("./contract");
const ROOT = "/root/fosu-collector-closure", CURRENT = "/opt/fosuclass/schedule-collector/current", STATE = "/var/lib/fosuclass/schedule-collector";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
function privatePath(file, directory = false) {
  if (!path.isAbsolute(file)) fail("CLOSURE_PRIVATE_PATH_REQUIRED");
  let cursor = file;
  while (cursor !== "/") {
    const stat = fs.lstatSync(cursor), leaf = cursor === file;
    if (stat.isSymbolicLink() || stat.uid !== 0 || leaf && ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600) || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) || !leaf && (!stat.isDirectory() || (stat.mode & 0o022))) fail("CLOSURE_PRIVATE_PERMISSIONS_REJECTED");
    cursor = path.dirname(cursor);
  }
}
function writeExclusive(file, value) {
  privatePath(path.dirname(file), true);
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const parent = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
function installed() {
  const proofRoot = "/root/fosu-collector-source-f076eac3";
  if (!fs.existsSync(path.join(proofRoot, "result.json"))) fail("CLOSURE_INSTALL_ACCEPTANCE_REQUIRED");
  privatePath(path.join(proofRoot, "result.json"));
  contract.validateInstallProof(JSON.parse(fs.readFileSync(path.join(proofRoot, "result.json"), "utf8")));
  if (fs.existsSync(path.join(proofRoot, "pending.json"))) fail("CLOSURE_SOURCE_UPGRADE_STILL_RUNNING");
  if (!fs.lstatSync(CURRENT).isSymbolicLink() || fs.realpathSync(CURRENT) !== "/opt/fosuclass/schedule-collector/releases/" + contract.WYZ_REVISION) fail("CLOSURE_INSTALLED_REVISION_MISMATCH");
  const release = fs.realpathSync(CURRENT), receipt = JSON.parse(fs.readFileSync(path.join(release, ".install-complete.json"), "utf8"));
  if (receipt.revision !== contract.WYZ_REVISION || receipt.bundleSha256 !== contract.SOURCE_SHA256 || receipt.runtimeVerified !== true) fail("CLOSURE_INSTALL_RECEIPT_REQUIRED");
  const pins = JSON.parse(fs.readFileSync(path.join(__dirname, "installed-source-pins.json"), "utf8"));
  if (pins.revision !== contract.WYZ_REVISION || pins.bundleSha256 !== contract.SOURCE_SHA256 || !Object.keys(pins.files || {}).length) fail("CLOSURE_SOURCE_PINS_REQUIRED");
  for (const [relative, expected] of Object.entries(pins.files)) {
    if (!/^(?:tools|server|deploy|shared)\/[A-Za-z0-9/._-]+$/.test(relative) || relative.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(expected)) fail("CLOSURE_SOURCE_PINS_REJECTED");
    const file = path.join(release, relative);
    if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile() || digest(fs.readFileSync(file)) !== expected) fail("CLOSURE_INSTALLED_SOURCE_MISMATCH");
  }
  return release;
}
function localGate(release, evidenceDir, stage) {
  const args = [path.join(release, "deploy/wyz/check-heartbeat-service.py"), "--state", "active", "--health"];
  args.push(stage === "before" ? "--record" : "--baseline", path.join(evidenceDir, "heartbeat-signatures.json"));
  try { execFileSync("python3", args, { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch { fail("CLOSURE_HEARTBEAT_PERSONAL_TIMER_GATE_FAILED"); }
  // This is the protected-file credential path actually used by the installed CLI.
  // Preserve a private fingerprint, never its contents. Session may change only
  // through the independently approved login; do not restore a stale snapshot.
  const credentialFile = path.join(STATE, "school-credentials.json");
  let credentialSha256 = null;
  if (fs.existsSync(credentialFile)) { privatePath(credentialFile); credentialSha256 = digest(fs.readFileSync(credentialFile)); }
  const credentialBaseline = path.join(evidenceDir, "protected-credential-fingerprint.json");
  if (stage === "before") writeExclusive(credentialBaseline, { credentialSha256 });
  else { privatePath(credentialBaseline); if (JSON.parse(fs.readFileSync(credentialBaseline, "utf8")).credentialSha256 !== credentialSha256) fail("CLOSURE_PROTECTED_CREDENTIAL_CHANGED"); }
}
function connect(release, signal) {
  const collector = require(path.join(release, "tools/wyz-schedule-collector/collector"));
  const env = require(path.join(release, "tools/wyz-schedule-collector/credentials")).readEnvFile("/etc/fosuclass/full-sync.env");
  const cfg = collector.config(env), transport = require(path.join(release, "tools/wyz-schedule-collector/oracleTransport"));
  const fetcher = cfg.transport.mode === "cloudflare-default" ? fetch : transport.createFetcher(cfg.transport);
  return { request: collector.client(cfg, fetcher, { signal }), close: () => fetcher.close?.() };
}
function parsePrepare(args) {
  const options = {};
  for (const arg of args) {
    if (arg === "--approve-school-window") { if (options.approved) fail("CLOSURE_ARGUMENT_REJECTED"); options.approved = true; continue; }
    if (arg === "--one-login") { if (options.oneLogin) fail("CLOSURE_ARGUMENT_REJECTED"); options.oneLogin = true; continue; }
    const match = arg.match(/^--(kind|run-id|term|request-budget|oracle-preflight|class-run-id|class-canonical-hash)=(.+)$/);
    if (!match || options[match[1]] !== undefined) fail("CLOSURE_ARGUMENT_REJECTED");
    options[match[1]] = match[2];
  }
  if (!options.approved || !options["oracle-preflight"]) fail("CLOSURE_EXPLICIT_APPROVAL_REQUIRED");
  return options;
}
async function prepare(args) {
  const opts = parsePrepare(args), release = installed();
  privatePath(opts["oracle-preflight"]);
  const oracleBytes = fs.readFileSync(opts["oracle-preflight"]);
  contract.validateOracleEvidence(JSON.parse(oracleBytes));
  const base = { schema: "collector-school-window.v1", runId: opts["run-id"], kind: opts.kind, term: opts.term, requestBudget: Number(opts["request-budget"] || 40), entityLimit: 1, allowOneLogin: opts.oneLogin === true, approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), wyzRevision: contract.WYZ_REVISION, oracleRevision: contract.ORACLE_REVISION, oraclePreflightSha256: digest(oracleBytes) };
  if (opts["class-run-id"] !== undefined) base.classRunId = opts["class-run-id"];
  if (opts["class-canonical-hash"] !== undefined) base.classCanonicalHash = opts["class-canonical-hash"];
  contract.validateApproval(base);
  const connection = connect(release);
  try {
    contract.validateReadiness(await connection.request("GET", "/api/full-sync/v1/sample/readiness"));
    const status = await connection.request("GET", "/api/full-sync/v1/status"), queued = status.status?.current;
    base.expiresAt = queued?.approvalExpiresAt;
    contract.validateApproval(base); contract.validateQueued(status, base);
  } finally { connection.close(); }
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { mode: 0o700 }); privatePath(ROOT, true);
  const dir = path.join(ROOT, base.runId);
  if (fs.existsSync(dir)) fail("CLOSURE_PREVIOUS_ATTEMPT_REVIEW_REQUIRED");
  fs.mkdirSync(dir, { mode: 0o700 });
  localGate(release, dir, "before");
  // Worker rechecks its gate into its own baseline, so preserve the prepare gate separately.
  fs.renameSync(path.join(dir, "heartbeat-signatures.json"), path.join(dir, "prepare-heartbeat-signatures.json"));
  fs.renameSync(path.join(dir, "protected-credential-fingerprint.json"), path.join(dir, "prepare-protected-credential-fingerprint.json"));
  writeExclusive(path.join(dir, "oracle-preflight.json"), JSON.parse(oracleBytes));
  // The source hash belongs to the received preflight, retained as raw bytes privately.
  fs.writeFileSync(path.join(dir, "oracle-preflight.original.json"), oracleBytes, { mode: 0o600, flag: "wx" });
  writeExclusive(path.join(dir, "approval.json"), base);
  return { status: "READY_TO_START_APPROVED_ONE_SHOT", runId: base.runId, approvalFile: path.join(dir, "approval.json"), kind: base.kind, requestBudget: base.requestBudget, schoolRequests: 0 };
}
async function run(file) {
  privatePath(file);
  if (file !== path.join(ROOT, path.basename(path.dirname(file)), "approval.json")) fail("CLOSURE_APPROVAL_PATH_REJECTED");
  const approval = JSON.parse(fs.readFileSync(file, "utf8")), evidenceDir = path.dirname(file);
  contract.validateApproval(approval);
  privatePath(path.join(evidenceDir, "oracle-preflight.original.json"));
  const oracleBytes = fs.readFileSync(path.join(evidenceDir, "oracle-preflight.original.json"));
  if (digest(oracleBytes) !== approval.oraclePreflightSha256) fail("CLOSURE_ORACLE_EVIDENCE_CHANGED");
  contract.validateOracleEvidence(JSON.parse(oracleBytes));
  const release = installed(), cli = require(path.join(release, "tools/wyz-schedule-collector/cli"));
  const control = new AbortController(), stop = () => control.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  process.env.PLAYWRIGHT_BROWSERS_PATH = STATE + "/browsers";
  const connection = connect(release, control.signal);
  const envHash = digest(fs.readFileSync("/etc/fosuclass/full-sync.env"));
  try {
    const result = await contract.execute(approval, {
      request: connection.request,
      reserve: async () => writeExclusive(path.join(evidenceDir, "school-access.started.json"), { runId: approval.runId, at: new Date().toISOString(), restartAllowed: false, passwordSubmissionLimit: approval.allowOneLogin ? 1 : 0 }),
      localGate: async stage => {
        installed();
        if (digest(fs.readFileSync("/etc/fosuclass/full-sync.env")) !== envHash) fail("CLOSURE_HEARTBEAT_ENV_CHANGED");
        localGate(release, evidenceDir, stage);
      },
      cli: args => cli.main(args, { signal: control.signal, output: () => {}, ask: async prompt => {
        if (prompt !== "确认本次 sample 范围并上传私有审核记录，输入 SAMPLE " + approval.kind + ": ") fail("CLOSURE_UNEXPECTED_CONFIRMATION");
        contract.validateApproval(approval);
        return "SAMPLE " + approval.kind;
      } }),
    });
    result.personalAgent = "UNCHANGED_LOCAL_SERVICE_CONTRACT";
    result.timer = "DISABLED"; result.heartbeatExecute = 0;
    writeExclusive(path.join(evidenceDir, "result.json"), result); return result;
  } catch (error) {
    const safe = { status: "BLOCKED", code: /^[A-Z0-9_]{1,80}$/.test(error.code || "") ? error.code : "CLOSURE_EXECUTION_FAILED", runId: approval.runId, replayAllowed: false, evidenceRetained: true, publication: "NOT_APPROVED" };
    const pins = JSON.parse(fs.readFileSync(path.join(__dirname, "installed-source-pins.json"), "utf8"));
    try { Object.assign(safe, require("./worker-diagnostics").read(path.join(STATE, "runs", approval.term, approval.runId), approval, pins.files["tools/fosu-sync-client/sync.js"])); } catch { safe.workerDiagnostics = "UNAVAILABLE"; }
    if (!fs.existsSync(path.join(evidenceDir, "result.json"))) writeExclusive(path.join(evidenceDir, "result.json"), safe);
    return safe;
  } finally { connection.close(); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}
async function main(args = process.argv.slice(2)) {
  if (process.platform !== "linux" || process.geteuid() !== 0) fail("CLOSURE_LINUX_ROOT_REQUIRED");
  if (args[0] === "prepare") return prepare(args.slice(1));
  if (args.length === 2 && args[0] === "run") return run(args[1]);
  fail("CLOSURE_ARGUMENT_REJECTED");
}
if (require.main === module) main().then(value => { console.log(JSON.stringify(value)); if (value.status === "BLOCKED") process.exitCode = 2; }).catch(error => { console.error(JSON.stringify({ status: "BLOCKED", code: /^[A-Z0-9_]{1,80}$/.test(error.code || "") ? error.code : "CLOSURE_PREPARATION_FAILED", publication: "NOT_APPROVED" })); process.exitCode = 2; });
module.exports = { parsePrepare, installed, privatePath, main };
