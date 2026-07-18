const fs = require("fs");
const path = require("path");

function invariant(condition, message) {
  if (!condition) throw new Error(`invalid deploy rollout manifest: ${message}`);
}

function resolveDeployRollout(manifestPath) {
  const absolutePath = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  invariant(manifest && manifest.schemaVersion === 1, "schemaVersion must be 1");
  invariant(typeof manifest.rolloutVersion === "string" && manifest.rolloutVersion.trim(), "rolloutVersion is required");
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.rolloutVersion), "rolloutVersion has an invalid format");
  invariant(["core", "browser"].includes(manifest.imageTarget), "imageTarget must be core or browser");
  invariant(manifest.admin && manifest.admin.primary === "legacy", "admin primary must remain legacy");
  invariant(manifest.admin.nextEnabled === true, "admin-next must remain enabled");
  invariant(manifest.modules && typeof manifest.modules === "object" && !Array.isArray(manifest.modules), "modules object is required");

  const writeModules = Object.entries(manifest.modules)
    .filter(([, config]) => config && config.productionWriteEnabled === true)
    .map(([name]) => name)
    .sort();
  writeModules.forEach((name) => invariant(/^[a-z][a-z0-9-]*$/.test(name), `invalid module name: ${name}`));

  return {
    schemaVersion: manifest.schemaVersion,
    rolloutVersion: manifest.rolloutVersion,
    imageTarget: manifest.imageTarget,
    adminPrimary: manifest.admin.primary,
    adminNextEnabled: manifest.admin.nextEnabled,
    writeModules,
  };
}

function writeGithubOutputs(outputPath, rollout) {
  invariant(outputPath, "GITHUB_OUTPUT path is required");
  const lines = [
    `rollout_version=${rollout.rolloutVersion}`,
    `image_target=${rollout.imageTarget}`,
    `admin_primary=${rollout.adminPrimary}`,
    `admin_next_enabled=${String(rollout.adminNextEnabled)}`,
    `write_modules=${rollout.writeModules.join(",")}`,
  ];
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

function parseArgs(argv) {
  const args = { githubOutput: false, manifestPath: path.resolve(__dirname, "..", "config", "admin-rollout-manifest.json") };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--github-output") args.githubOutput = true;
    else if (value === "--manifest" && argv[index + 1]) args.manifestPath = path.resolve(argv[++index]);
    else throw new Error(`unknown or incomplete argument: ${value}`);
  }
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const rollout = resolveDeployRollout(args.manifestPath);
    if (args.githubOutput) writeGithubOutputs(process.env.GITHUB_OUTPUT, rollout);
    process.stdout.write(`${JSON.stringify({ ok: true, ...rollout })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  resolveDeployRollout,
  writeGithubOutputs,
};
