const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf-8"));
const buildInfo = require("../miniprogram/config/buildInfo");

const scripts = packageJson.scripts || {};
const report = {
  success: true,
  generatedAt: new Date().toISOString(),
  miniprogram: {
    miniprogramRoot: projectConfig.miniprogramRoot,
    compileType: projectConfig.compileType,
    clientBuildId: buildInfo.CLIENT_BUILD_ID,
    gitCommitShortSha: buildInfo.GIT_COMMIT_SHORT_SHA,
    requestPipelineVersion: buildInfo.REQUEST_PIPELINE_VERSION,
    buildTimestamp: buildInfo.BUILD_TIMESTAMP,
  },
  commands: {
    acceptance: scripts["security:acceptance"],
    postdeploy: scripts["security:postdeploy"],
    report: scripts["security:report"],
    securityFull: scripts["test:security-full"],
  },
  redaction: {
    containsSecrets: false,
    note: "This report intentionally omits tokens, tickets, cookies, OpenID, passwords, and API secrets.",
  },
};

console.log(JSON.stringify(report, null, 2));
