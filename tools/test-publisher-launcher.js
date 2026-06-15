const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cmdPath = path.join(root, "佛课小表一键同步.cmd");
const psPath = path.join(root, "tools", "fosu-publisher", "run-publisher.ps1");

function includes(text, needle, label) {
  assert(text.includes(needle), `${label || needle} missing`);
}

function run() {
  const cmd = fs.readFileSync(cmdPath);
  assert(cmd.includes(Buffer.from("\r\n")), "CMD file must use CRLF line endings");
  const cmdText = cmd.toString("utf8");
  includes(cmdText, "chcp 65001", "UTF-8 code page");
  includes(cmdText, "title 佛课小表一键同步", "window title");
  includes(cmdText, 'cd /d "%~dp0"', "project root cd");
  includes(cmdText, "powershell.exe -NoProfile -ExecutionPolicy Bypass", "PowerShell launcher");
  includes(cmdText, "run-publisher.ps1", "launcher script");
  assert(!/^\s*npm\s+run\s+sync:publish/m.test(cmdText), "CMD must not run bare npm run sync:publish");

  const ps = fs.readFileSync(psPath, "utf8");
  includes(ps, ".local\\publisher-launcher", "launcher log directory");
  includes(ps, "--self-test", "self-test flag");
  includes(ps, "--noninteractive", "noninteractive flag");
  includes(ps, "Read-Host \"按 Enter 关闭窗口\"", "interactive pause");
  includes(ps, "[Environment]::UserInteractive", "scheduled task guard");
  includes(ps, "node-version", "node version stage");
  includes(ps, "npm-version", "npm version stage");
  includes(ps, "tools/fosu-publisher/publish.js", "publisher direct node entry");
  includes(ps, "当前阶段", "failure stage");
  includes(ps, "error code", "failure code");
  includes(ps, "state.json", "state path");
  includes(ps, "error.json", "error path");
  includes(ps, "resume 命令", "resume command");
  includes(ps, "Oracle 状态", "Oracle summary");
  includes(ps, "CloudBase 状态", "CloudBase summary");
  includes(ps, "receipt 路径", "receipt path");
  includes(ps, "是否 no-change", "no-change summary");
  assert(!/npm\s+run\s+sync:publish(?!\s+-- --mode=resume)/.test(ps), "launcher should not invoke bare npm run sync:publish");

  console.log("test-publisher-launcher passed");
}

run();
