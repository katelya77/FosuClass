"use strict";
// Explicit, operator-approved Sample task creation on the Oracle host.
// Uses the existing local admin API; never prints or prompts for a credential.
const fs = require("node:fs"), path = require("node:path");
function fail(code) { throw Object.assign(new Error(code), { code }); }
function parse(args) {
  const opts = {};
  for (const arg of args) {
    const m = arg.match(/^--(app-dir|approve-sample|idempotency-key|term)=(.+)$/);
    if (!m || opts[m[1]] !== undefined) fail("SAMPLE_QUEUE_ARGUMENT_REJECTED");
    opts[m[1]] = m[2];
  }
  if (!opts["app-dir"] || !["class", "four"].includes(opts["approve-sample"]) || !/^[A-Za-z0-9._:-]{8,80}$/.test(opts["idempotency-key"] || "") || opts.term && !/^\d{4}-\d{4}-[12]$/.test(opts.term)) fail("SAMPLE_QUEUE_ARGUMENT_REJECTED");
  return opts;
}
function adminCredential(envFile) {
  const stat = fs.lstatSync(envFile);
  if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== "win32" && (stat.mode & 0o077)) fail("SAMPLE_ENV_PERMISSIONS_REJECTED");
  const values = {};
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(['"])/.test(value)) {
      const quote = value[0], end = value.lastIndexOf(quote);
      if (end < 1) fail("SAMPLE_ENV_INVALID");
      value = value.slice(1, end);
    } else value = value.replace(/\s+#.*$/, "").trim();
    values[match[1]] = value;
  }
  if (!values.ADMIN_API_TOKEN || values.ADMIN_API_TOKEN.length < 16 || /[\r\n]/.test(values.ADMIN_API_TOKEN)) fail("SAMPLE_ADMIN_CREDENTIAL_REQUIRED");
  return values.ADMIN_API_TOKEN;
}
async function localRequest(method, route, token, body) {
  const response = await fetch("http://127.0.0.1:18318" + route, {
    method, redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { authorization: "Bearer " + token, "content-type": "application/json", "x-fosu-client": "service" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let value;
  try { value = await response.json(); } catch { fail("SAMPLE_API_RESPONSE_REJECTED"); }
  if (!response.ok) fail(/^SAMPLE_|^COLLECTOR_|^ADMIN_/.test(value.code || "") ? value.code : "SAMPLE_API_REQUEST_REJECTED");
  return value;
}
async function main(args = process.argv.slice(2), deps = {}) {
  const opts = parse(args);
  if (!deps.skipRootCheck && (process.platform === "win32" || typeof process.geteuid !== "function" || process.geteuid() !== 0)) fail("SAMPLE_QUEUE_ROOT_REQUIRED");
  const envFile = path.join(path.resolve(opts["app-dir"]), "server", ".env");
  const token = (deps.readCredential || adminCredential)(envFile), request = deps.request || localRequest;
  const readiness = await request("GET", "/api/admin/schedule-collector/sample/readiness", token);
  if (readiness.protocol !== "collector-manual.v1" || readiness.sampleOnly !== true || readiness.publishable !== false) fail("SAMPLE_API_NOT_READY");
  if (readiness.ready !== true) fail(["SAMPLE_SIGNATURE_NOT_CONFIGURED", "RELEASE_WORKER_DISABLED", "COLLECTOR_PAUSED", "SAMPLE_AUTH_REVIEW_REQUIRED", "SAMPLE_APPROVAL_EXPIRED"].includes(readiness.code) ? readiness.code : "SAMPLE_API_NOT_READY");
  const body = { sampleKind: opts["approve-sample"], requestBudget: 40, idempotencyKey: opts["idempotency-key"] };
  if (opts.term) body.term = opts.term;
  const response = await request("POST", "/api/admin/schedule-collector/actions/sample", token, body);
  const queued = response.queued, run = queued?.run;
  if (response.success !== true || !run || !/^sc-[A-Za-z0-9-]+$/.test(run.id || "") || run.mode !== "sample" || run.samplePolicy?.kind !== body.sampleKind || run.samplePolicy.requestBudget !== 40 || run.publishable !== false || run.coverageValid !== false) fail("SAMPLE_TASK_NOT_CREATED");
  return { protocol: "collector-manual.v1", source: "oracle-live", status: run.finishedAt ? "BLOCKED" : "PASS", code: run.finishedAt ? "SAMPLE_TASK_ALREADY_FINISHED" : queued.skipped ? "SAMPLE_TASK_IDEMPOTENT_REPLAY" : "SAMPLE_TASK_APPROVED", runId: run.id, term: run.term, sampleKind: run.samplePolicy.kind, requestBudget: 40, entityLimit: 1, approvalExpiresAt: run.approvalExpiresAt, sampleOnly: true, publishable: false, coverageValid: false, schoolRequests: 0 };
}
if (require.main === module) main().then(value => { console.log(JSON.stringify(value, null, 2)); if (value.status !== "PASS") process.exitCode = 1; }).catch(error => { console.log(JSON.stringify({ status: "BLOCKED", code: /^SAMPLE_|^COLLECTOR_|^ADMIN_|^RELEASE_WORKER_DISABLED$/.test(error.code || "") ? error.code : "SAMPLE_QUEUE_FAILED", schoolRequests: 0 })); process.exitCode = 1; });
module.exports = { parse, adminCredential, main };
