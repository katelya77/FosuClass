const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");

const root = path.resolve(__dirname, "..");
const cmdFiles = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".cmd"));
assert.strictEqual(cmdFiles.length, 1, "repository should have exactly one CMD launcher");
const cmdFile = cmdFiles[0];
const cmdPath = path.join(root, cmdFile);
const psPath = path.join(root, "tools", "fosu-publisher", "run-publisher.ps1");
const attrsPath = path.join(root, ".gitattributes");

function includes(text, needle, label) {
  assert(text.includes(needle), `${label || needle} missing`);
}

function attrLineExists(attrs, line) {
  return attrs.replace(/\r\n/g, "\n").split("\n").some((item) => item.trim() === line);
}

function run() {
  assert(/[^\x00-\x7F]/.test(cmdFile), "CMD launcher filename must preserve Chinese characters");

  const attrs = fs.readFileSync(attrsPath, "utf8");
  assert(attrLineExists(attrs, "*.cmd text eol=crlf"), ".gitattributes must require CRLF for CMD launchers");

  const cmdBytes = fs.readFileSync(cmdPath);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const cmdText = decoder.decode(cmdBytes);
  const normalized = cmdText.replace(/\r\n/g, "\n");

  if (process.platform === "win32") {
    assert(cmdBytes.includes(Buffer.from("\r\n")), "Windows CMD checkout must use CRLF line endings");
    assert(!/(^|[^\r])\n/.test(cmdBytes.toString("binary")), "Windows CMD checkout must not contain bare LF");
  }

  includes(normalized, "chcp 65001", "UTF-8 code page");
  includes(normalized, "title ", "window title");
  includes(normalized, 'cd /d "%~dp0"', "project root cd");
  includes(normalized, "powershell.exe -NoProfile -ExecutionPolicy Bypass", "PowerShell launcher");
  includes(normalized, "tools\\fosu-publisher\\run-publisher.ps1", "PowerShell launcher path");
  assert(!/^\s*npm\s+run\s+sync:publish/m.test(normalized), "CMD must not run bare npm run sync:publish");

  const ps = fs.readFileSync(psPath, "utf8");
  includes(ps, ".local\\publisher-launcher", "launcher log directory");
  includes(ps, "--self-test", "self-test flag");
  includes(ps, "--noninteractive", "noninteractive flag");
  includes(ps, "[Environment]::UserInteractive", "scheduled task guard");
  includes(ps, "node-version", "node version stage");
  includes(ps, "npm-version", "npm version stage");
  includes(ps, "tools/fosu-publisher/publish.js", "publisher direct node entry");
  includes(ps, "state.json", "state path");
  includes(ps, "error.json", "error path");
  includes(ps, "receipt.json", "receipt path");
  includes(ps, "ADMIN_API_TOKEN_REQUIRED", "admin token setup guidance");
  includes(ps, "publisher:token:setup", "token setup command");
  includes(ps, "publisher:token:verify", "token verify command");
  includes(ps, "-- --rotate", "token rotate command");
  includes(ps, "currentStage", "publisher currentStage summary");
  includes(ps, "Get-PublisherFailureDetails", "publisher failure details");
  includes(ps, 'currentStageText -ne "local-preflight"', "local-preflight should not advertise resume");
  includes(ps, "resume 命令", "resume command");
  includes(ps, "Oracle 状态", "Oracle summary");
  includes(ps, "CloudBase 状态", "CloudBase summary");
  includes(ps, "是否 no-change", "no-change summary");
  assert(!/Invoke-LoggedCommand[\s\S]*-File\s+"npm"[\s\S]*sync:publish/.test(ps), "launcher should not invoke publisher through npm");

  console.log("test-publisher-launcher passed");
}

run();
