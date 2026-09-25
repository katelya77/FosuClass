const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sha = "bundletest";
const built = spawnSync(process.execPath, [path.join(root, "tools", "build-wyz-campus-agent-bundle.js"), sha], { cwd: root, encoding: "utf8" });
assert.strictEqual(built.status, 0, built.stderr || built.stdout);
const archive = path.join(root, ".local", `wyz-campus-agent-${sha}.tar.gz`);
assert.ok(fs.existsSync(archive));
const listed = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
assert.strictEqual(listed.status, 0, listed.stderr);
const names = listed.stdout.split(/\r?\n/);
for (const required of [
  "package.json",
  "package-lock.json",
  "vendor/fosuDirectClient.js",
  "vendor/fosuDirectConfig.js",
  "vendor/fosuDirectCookieJar.js",
  "vendor/fosuDirectDiagnostics.js",
  "vendor/fosuDirectHtml.js",
  "vendor/fosuDirectPasswordCrypto.js",
  "vendor/fosuDirectRedirect.js",
  "vendor/fosuDirectUrl.js",
  "vendor/studentProfileParser.js",
  "vendor/schoolHtmlCharset.js",
  "vendor/iconv-lite/package.json",
  "src/index.js",
  "src/signature.js",
  "install.sh",
  "verify-wyz.sh",
  "wyz-campus-agent.service",
]) {
  assert.ok(names.some((name) => name.replace(/\\/g, "/").endsWith(required)), required);
}
const install = fs.readFileSync(path.join(root, "deploy", "wyz-campus-agent", "install-wyz.sh"), "utf8");
assert.ok(!install.includes("miniprogram/services"));
console.log("wyz-campus-agent-bundle PASS");
