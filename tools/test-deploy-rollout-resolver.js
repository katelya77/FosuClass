const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveDeployRollout, writeGithubOutputs } = require("./resolve-deploy-rollout");

const root = path.resolve(__dirname, "..");
const rollout = resolveDeployRollout(path.join(root, "config", "admin-rollout-manifest.json"));

assert.deepStrictEqual(rollout, {
  schemaVersion: 1,
  rolloutVersion: "2026-07-18.c1-foundation.1",
  imageTarget: "browser",
  adminPrimary: "legacy",
  adminNextEnabled: true,
  writeModules: ["audit", "backups", "content", "feedback"],
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-deploy-rollout-"));
try {
  const outputPath = path.join(tempRoot, "github-output.txt");
  writeGithubOutputs(outputPath, rollout);
  const output = fs.readFileSync(outputPath, "utf8");
  assert.match(output, /^image_target=browser$/m);
  assert.match(output, /^write_modules=audit,backups,content,feedback$/m);
  assert.match(output, /^admin_primary=legacy$/m);
  assert.match(output, /^admin_next_enabled=true$/m);

  const invalidTargetPath = path.join(tempRoot, "invalid-target.json");
  fs.writeFileSync(invalidTargetPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, "config", "admin-rollout-manifest.json"), "utf8")), imageTarget: "latest" }));
  assert.throws(() => resolveDeployRollout(invalidTargetPath), /imageTarget must be core or browser/);

  const invalidPrimaryPath = path.join(tempRoot, "invalid-primary.json");
  const invalidPrimary = JSON.parse(fs.readFileSync(path.join(root, "config", "admin-rollout-manifest.json"), "utf8"));
  invalidPrimary.admin.primary = "next";
  fs.writeFileSync(invalidPrimaryPath, JSON.stringify(invalidPrimary));
  assert.throws(() => resolveDeployRollout(invalidPrimaryPath), /admin primary must remain legacy/);

  const invalidNextPath = path.join(tempRoot, "invalid-next.json");
  const invalidNext = JSON.parse(fs.readFileSync(path.join(root, "config", "admin-rollout-manifest.json"), "utf8"));
  invalidNext.admin.nextEnabled = false;
  fs.writeFileSync(invalidNextPath, JSON.stringify(invalidNext));
  assert.throws(() => resolveDeployRollout(invalidNextPath), /admin-next must remain enabled/);

  const injectedVersionPath = path.join(tempRoot, "injected-version.json");
  const injectedVersion = JSON.parse(fs.readFileSync(path.join(root, "config", "admin-rollout-manifest.json"), "utf8"));
  injectedVersion.rolloutVersion = "safe\nwrite_modules=release";
  fs.writeFileSync(injectedVersionPath, JSON.stringify(injectedVersion));
  assert.throws(() => resolveDeployRollout(injectedVersionPath), /rolloutVersion has an invalid format/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, imageTarget: rollout.imageTarget, writeModules: rollout.writeModules }, null, 2));
