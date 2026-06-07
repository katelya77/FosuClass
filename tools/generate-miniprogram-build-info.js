const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  if (!match) return fallback;
  if (match === name) {
    const index = process.argv.indexOf(match);
    return process.argv[index + 1] || fallback;
  }
  return match.slice(prefix.length) || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function gitShortSha() {
  const result = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  if (result.status !== 0) return "unknown";
  return String(result.stdout || "").trim() || "unknown";
}

function normalizeTimestamp(input) {
  const value = String(input || "").trim();
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid build timestamp: ${value}`);
  }
  return date.toISOString();
}

function makeBuildInfo(options = {}) {
  const pipelineVersion = String(options.pipelineVersion || "security-transport-v2").trim();
  const gitCommitShortSha = String(options.gitCommitShortSha || gitShortSha()).trim();
  const buildTimestamp = normalizeTimestamp(options.buildTimestamp);
  const compactTimestamp = buildTimestamp.replace(/[-:.TZ]/g, "").slice(0, 14);
  const clientBuildId = `${pipelineVersion}-${gitCommitShortSha}-${compactTimestamp}`;
  return {
    BUILD_TIMESTAMP: buildTimestamp,
    CLIENT_BUILD_ID: clientBuildId,
    GIT_COMMIT_SHORT_SHA: gitCommitShortSha,
    REQUEST_PIPELINE_VERSION: pipelineVersion,
  };
}

function renderBuildInfo(info) {
  return [
    `const REQUEST_PIPELINE_VERSION = ${JSON.stringify(info.REQUEST_PIPELINE_VERSION)};`,
    `const GIT_COMMIT_SHORT_SHA = ${JSON.stringify(info.GIT_COMMIT_SHORT_SHA)};`,
    `const BUILD_TIMESTAMP = ${JSON.stringify(info.BUILD_TIMESTAMP)};`,
    "const CLIENT_BUILD_ID = `${REQUEST_PIPELINE_VERSION}-${GIT_COMMIT_SHORT_SHA}-${BUILD_TIMESTAMP.replace(/[-:.TZ]/g, \"\").slice(0, 14)}`;",
    "",
    "module.exports = {",
    "  BUILD_TIMESTAMP,",
    "  CLIENT_BUILD_ID,",
    "  GIT_COMMIT_SHORT_SHA,",
    "  REQUEST_PIPELINE_VERSION,",
    "};",
    "",
  ].join("\n");
}

function appendEnvFile(filePath, lines) {
  if (!filePath) return;
  fs.appendFileSync(filePath, `${lines.join("\n")}\n`);
}

function main() {
  const info = makeBuildInfo({
    pipelineVersion: argValue("--pipeline-version", process.env.REQUEST_PIPELINE_VERSION || "security-transport-v2"),
    gitCommitShortSha: argValue("--commit-sha", process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : ""),
    buildTimestamp: argValue("--timestamp", process.env.BUILD_TIMESTAMP || ""),
  });

  if (!hasFlag("--dry-run")) {
    const target = path.join(__dirname, "..", "miniprogram", "config", "buildInfo.js");
    fs.writeFileSync(target, renderBuildInfo(info));
  }

  const envLines = [
    `FOSU_CLIENT_BUILD_ID=${info.CLIENT_BUILD_ID}`,
    `FOSU_CLIENT_GIT_COMMIT_SHORT_SHA=${info.GIT_COMMIT_SHORT_SHA}`,
    `FOSU_CLIENT_BUILD_TIMESTAMP=${info.BUILD_TIMESTAMP}`,
  ];
  appendEnvFile(process.env.GITHUB_ENV, envLines);

  if (process.env.GITHUB_OUTPUT) {
    appendEnvFile(process.env.GITHUB_OUTPUT, [
      `client_build_id=${info.CLIENT_BUILD_ID}`,
      `client_git_commit_short_sha=${info.GIT_COMMIT_SHORT_SHA}`,
      `client_build_timestamp=${info.BUILD_TIMESTAMP}`,
    ]);
  }

  console.log(JSON.stringify(info, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  makeBuildInfo,
  renderBuildInfo,
};
