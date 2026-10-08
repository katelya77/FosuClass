#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const root = path.resolve(__dirname, "../..");
function build(outputRoot = path.join(root, ".local", "collector-packages")) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidates = execFileSync("git", ["ls-files", "tools/wyz-schedule-collector", "tools/fosu-sync-client", "server/src", "server/config", "server/package.json", "server/package-lock.json", "shared", "config/terms", "miniprogram/utils/courseWeekRules.js", "deploy/wyz/wyz-schedule-collector.service", "deploy/wyz/wyz-schedule-collector.timer", "deploy/wyz/install-schedule-collector.sh"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim().split(/\r?\n/);
  const files = candidates.filter((file) => /\.(js|json|service|timer|sh)$/.test(file) && !/(?:^|\/)(?:session|\.env|storage|data|debug|raw|node_modules)(?:[./]|$)/i.test(file));
  fs.mkdirSync(outputRoot, { recursive: true });
  const tar = path.join(outputRoot, "collector-source-" + sha + ".tar");
  execFileSync("git", ["archive", "--format=tar", "--output=" + tar, "HEAD", "--", ...files], { cwd: root });
  const target = path.join(outputRoot, "wyz-schedule-collector-" + sha + ".tar.gz");
  fs.writeFileSync(target, require("zlib").gzipSync(fs.readFileSync(tar), { level: 9 }));
  fs.unlinkSync(tar);
  const receipt = { sha, path: target, size: fs.statSync(target).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex"), files: files.length, timerEnabled: false, personalServiceChanged: false, oraclePath: "NOT_UPLOADED" };
  fs.writeFileSync(target + ".receipt.json", JSON.stringify(receipt, null, 2));
  return receipt;
}
if (require.main === module) console.log(JSON.stringify(build(), null, 2));
module.exports = { build };
