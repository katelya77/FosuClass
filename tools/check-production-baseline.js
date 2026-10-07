"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

function commitSha(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error("Production baseline must be a full Git commit SHA");
  }
  return value.toLowerCase();
}

function verifyAncestry(baseline, candidate = "HEAD", cwd = process.cwd()) {
  baseline = commitSha(baseline);
  const resolved = spawnSync("git", ["rev-parse", "--verify", `${candidate}^{commit}`], { cwd, encoding: "utf8", windowsHide: true });
  if (resolved.status !== 0) throw new Error("Cannot resolve release candidate commit");
  const candidateSha = commitSha(resolved.stdout.trim());
  const check = spawnSync("git", ["merge-base", "--is-ancestor", baseline, candidateSha], { cwd, encoding: "utf8", windowsHide: true });
  if (check.status !== 0) {
    throw new Error(`Release blocked: candidate ${candidateSha} does not contain deployed commit ${baseline}. Merge the production changes first; use a revert commit for an intentional rollback.`);
  }
  return { success: true, baseline, candidate: candidateSha };
}

async function readProductionCommit({ baseUrl = "https://class.katelya.eu.org", token = process.env.ADMIN_API_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error("Production baseline verification requires ADMIN_API_TOKEN");
  const response = await fetchImpl(new URL("/api/admin/security/status", baseUrl), {
    headers: { "X-Admin-Token": token, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Cannot verify production baseline (HTTP ${response.status})`);
  const status = await response.json();
  return commitSha(status.deployment && status.deployment.commitSha);
}

function readSuccessfulDeployment({ run = spawnSync, cwd = process.cwd() } = {}) {
  const result = run("gh", ["run", "list", "--workflow", "deploy-vps.yml", "--status", "success", "--limit", "1", "--json", "headSha,status,conclusion"], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Cannot read the last successful controlled production deployment");
  let rows;
  try { rows = JSON.parse(result.stdout); } catch { throw new Error("Invalid controlled deployment record"); }
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].status !== "completed" || rows[0].conclusion !== "success") throw new Error("No verified successful production deployment baseline");
  return commitSha(rows[0].headSha);
}

async function main(args = process.argv.slice(2)) {
  const baselineArg = args.find(arg => arg.startsWith("--baseline="));
  const workflow = args.includes("--workflow");
  if (args.some(arg => !arg.startsWith("--baseline=") && arg !== "--workflow") || (workflow && baselineArg)) throw new Error("Unsupported production baseline argument");
  // CI reads the last verified workflow; the existing protected SSH step then attests the live origin before any upload.
  const baseline = workflow ? readSuccessfulDeployment() : baselineArg ? commitSha(baselineArg.slice("--baseline=".length)) : await readProductionCommit();
  const result = verifyAncestry(baseline);
  if (workflow && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `baseline=${baseline}\n`);
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { commitSha, verifyAncestry, readProductionCommit, readSuccessfulDeployment, main };
