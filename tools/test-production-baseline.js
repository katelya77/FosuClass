"use strict";
const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { commitSha, verifyAncestry, readProductionCommit, readSuccessfulDeployment } = require("./check-production-baseline");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-production-baseline-"));
function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function commit(name) { fs.writeFileSync(path.join(root, name), name); git("add", name); git("commit", "-m", name); return git("rev-parse", "HEAD"); }
git("init", "-b", "main"); git("config", "user.name", "Baseline Test"); git("config", "user.email", "baseline@example.invalid");
const base = commit("base"); git("checkout", "-b", "production-feature"); const production = commit("announcement");
git("checkout", "-b", "schedule-fix", base); commit("class-split");

test("旧main上的课表修复不能覆盖已上线的公告功能分支", () => {
  assert.throws(() => verifyAncestry(production, "HEAD", root), /does not contain deployed commit/);
});
test("合入已上线分支后可以发布，既有功能提交仍保留", () => {
  git("merge", "--no-ff", "production-feature", "-m", "preserve production");
  assert.equal(verifyAncestry(production, "HEAD", root).success, true);
  assert.equal(verifyAncestry(base, "HEAD", root).success, true);
});
test("无鉴权、接口失败或无效生产指纹必须阻断发布", async () => {
  assert.throws(() => commitSha("HEAD"), /full Git/);
  await assert.rejects(readProductionCommit({ token: "" }), /requires ADMIN_API_TOKEN/);
  await assert.rejects(readProductionCommit({ token: "local-test", fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
  await assert.rejects(readProductionCommit({ token: "local-test", fetchImpl: async () => ({ ok: true, json: async () => ({ deployment: {} }) }) }), /full Git/);
});
test("生产基线只从受保护的部署指纹读取", async () => {
  const sha = await readProductionCommit({ token: "local-test", fetchImpl: async (url, options) => {
    assert.equal(url.pathname, "/api/admin/security/status");
    assert.equal(options.headers["X-Admin-Token"], "local-test");
    assert.equal(options.headers.Authorization, "Bearer local-test");
    return { ok: true, json: async () => ({ deployment: { commitSha: production } }) };
  } });
  assert.equal(sha, production);
});
test("受控发布必须在上传之前验证生产基线，并保留两组业务回归", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/deploy-vps.yml"), "utf8");
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal((workflow.match(/fetch-depth: 0/g) || []).length, 2);
  assert.ok(workflow.indexOf("run: node tools/check-production-baseline.js") < workflow.indexOf("- name: Upload WYZ bundle to Oracle"));
  assert.ok(workflow.indexOf("- name: Verify live production baseline before upload") < workflow.indexOf("- name: Upload WYZ bundle to Oracle"));
  assert.match(workflow, /127\.0\.0\.1:18318\/api\/admin\/security\/status/);
  assert.match(workflow, /LIVE_SHA.*EXPECTED_SHA/);
  assert.match(workflow, /run: npm run test:notice-reactions/);
  assert.match(workflow, /run: npm run test:class-schedule-isolation/);
  assert.match(workflow, /run: npm run test:production-baseline/);
});
test("CI只能选已成功终结的受控部署，并由SSH在源站再次核对", () => {
  const sha=readSuccessfulDeployment({run(command,args){assert.equal(command,"gh");assert.ok(args.includes("deploy-vps.yml")&&args.includes("success"));return {status:0,stdout:JSON.stringify([{headSha:production,status:"completed",conclusion:"success"}])};}});
  assert.equal(sha,production);
});
test("缺少成功记录、未终结记录或读取失败不能跳过基线", () => {
  for(const result of [{status:1},{status:0,stdout:"[]"},{status:0,stdout:"invalid"},{status:0,stdout:JSON.stringify([{headSha:production,status:"in_progress",conclusion:""}])}])assert.throws(()=>readSuccessfulDeployment({run:()=>result}));
});
after(() => {
  const relative = path.relative(os.tmpdir(), path.resolve(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(root).startsWith("fosu-production-baseline-"));
  fs.rmSync(root, { recursive: true, force: true });
});
