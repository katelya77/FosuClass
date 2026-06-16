const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const attrs = fs.readFileSync(path.join(root, ".gitattributes"), "utf8").replace(/\r\n/g, "\n");

function hasAttrLine(line) {
  return attrs.split("\n").some((item) => item.trim() === line);
}

[
  "*.cmd text eol=crlf",
  "*.bat text eol=crlf",
  "*.ps1 text eol=crlf",
  "*.sh text eol=lf",
  "*.js text eol=lf",
  "*.json text eol=lf",
  "*.yml text eol=lf",
  "*.yaml text eol=lf",
].forEach((line) => {
  assert(hasAttrLine(line), `.gitattributes must contain ${line}`);
});

const cmdFile = fs.readdirSync(root).find((name) => name.toLowerCase().endsWith(".cmd"));
assert(cmdFile, "repository must include the one-click CMD launcher");
assert(/[^\x00-\x7F]/.test(cmdFile), "CMD launcher filename should preserve Chinese characters");

const attr = spawnSync("git", ["check-attr", "eol", "--", cmdFile], {
  cwd: root,
  encoding: "utf8",
});
assert.strictEqual(attr.status, 0, attr.stderr);
assert(attr.stdout.includes("eol: crlf"), `CMD launcher must resolve to eol=crlf: ${attr.stdout}`);

if (process.platform === "win32") {
  const bytes = fs.readFileSync(path.join(root, cmdFile));
  assert(bytes.includes(Buffer.from("\r\n")), "Windows checkout should contain CRLF bytes for CMD");
  assert(!/(^|[^\r])\n/.test(bytes.toString("binary")), "Windows CMD checkout must not contain bare LF");
}

console.log("test-gitattributes-eol passed");
