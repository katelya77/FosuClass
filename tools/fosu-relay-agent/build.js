const fs = require("fs");
const path = require("path");

const root = __dirname;
const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });

const source = path.join(root, "relay-agent.js");
const jsTarget = path.join(distDir, "fosu-relay-agent-win-x64.js");
const cmdTarget = path.join(distDir, "fosu-relay-agent-win-x64.cmd");

fs.copyFileSync(source, jsTarget);
fs.writeFileSync(
  cmdTarget,
  "@echo off\r\nnode \"%~dp0fosu-relay-agent-win-x64.js\" %*\r\n",
  "utf-8"
);

console.log(`Relay agent bundle written to ${distDir}`);
console.log("Windows users can run dist\\fosu-relay-agent-win-x64.cmd with --server, --token, --term and --file.");
