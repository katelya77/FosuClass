const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const sha = String(process.argv[2] || process.env.GITHUB_SHA || "local").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40) || "local";
const staging = path.join(root, ".local", `wyz-campus-agent-${sha}`);
const archive = path.join(root, ".local", `wyz-campus-agent-${sha}.tar.gz`);
const source = path.join(root, "deploy", "wyz-campus-agent");
const vendorFiles = [
  "fosuDirectClient.js",
  "fosuDirectConfig.js",
  "fosuDirectCookieJar.js",
  "fosuDirectDiagnostics.js",
  "fosuDirectHtml.js",
  "fosuDirectPasswordCrypto.js",
  "fosuDirectRedirect.js",
  "fosuDirectUrl.js",
];

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(path.join(staging, "src"), { recursive: true });
fs.mkdirSync(path.join(staging, "vendor"), { recursive: true });
for (const name of ["package.json", "package-lock.json", "wyz-campus-agent.service", "verify-wyz.sh"]) {
  fs.copyFileSync(path.join(source, name), path.join(staging, name));
}
fs.copyFileSync(path.join(source, "install-wyz.sh"), path.join(staging, "install.sh"));
for (const name of ["index.js", "signature.js"]) {
  fs.copyFileSync(path.join(source, "src", name), path.join(staging, "src", name));
}
for (const name of vendorFiles) {
  fs.copyFileSync(path.join(root, "miniprogram", "services", name), path.join(staging, "vendor", name));
}
fs.rmSync(archive, { force: true });
const packed = spawnSync("tar", ["-czf", archive, "-C", path.dirname(staging), path.basename(staging)], { stdio: "inherit" });
if (packed.status !== 0) process.exit(packed.status || 1);
console.log(archive);
