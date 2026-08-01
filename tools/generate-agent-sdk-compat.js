#!/usr/bin/env node
/**
 * 将环境无关的 packages/agent-sdk 与 packages/ui-schema 打包为小程序可
 * require 的单文件产物 miniprogram/shared/agentSdk.generated.js。
 *
 * 小程序运行时无法引用 miniprogram/ 之外的源码（仓库惯例：生成拷贝进
 * miniprogram/shared/，见 generate-agent-capability-compat.js）。源文件全部
 * 为纯 JS 零 Node 依赖（test-agent-sdk.js C11 静态扫描强制），打包只做
 * 模块包装，不做任何语义改写。--check 模式校验产物新鲜度（CI 门禁用）。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sources = [
  { id: "runStateMachine", file: path.join(root, "packages", "agent-sdk", "src", "runStateMachine.js") },
  { id: "client", file: path.join(root, "packages", "agent-sdk", "src", "client.js") },
  { id: "uiBlocks", file: path.join(root, "packages", "ui-schema", "src", "blocks.js") },
];
const outputPath = path.join(root, "miniprogram", "shared", "agentSdk.generated.js");

function wrapModule(id, source) {
  // client.js 唯一的相对 require 指向 runStateMachine，替换为注册表引用。
  const rewritten = source.replace(/require\("\.\/runStateMachine"\)/g, '__requireModule("runStateMachine")');
  if (/\brequire\(/.test(rewritten.replace(/__requireModule\(/g, "("))) {
    throw new Error(`module ${id} has unexpected require() — bundler only supports ./runStateMachine`);
  }
  return [
    `__registerModule(${JSON.stringify(id)}, function () {`,
    "const module = { exports: {} };",
    rewritten,
    "return module.exports;",
    "});",
  ].join("\n");
}

function render() {
  const parts = [
    "// Generated from packages/agent-sdk + packages/ui-schema. Do not edit by hand.",
    "// Regenerate: node tools/generate-agent-sdk-compat.js",
    "const __moduleRegistry = {};",
    "function __registerModule(id, factory) { __moduleRegistry[id] = factory(); }",
    "function __requireModule(id) {",
    "  const mod = __moduleRegistry[id];",
    "  if (!mod) throw new Error(\"agent-sdk bundle missing module: \" + id);",
    "  return mod;",
    "}",
    "",
  ];
  sources.forEach(({ id, file }) => {
    parts.push(wrapModule(id, fs.readFileSync(file, "utf8")));
    parts.push("");
  });
  parts.push([
    "const runStateMachine = __requireModule(\"runStateMachine\");",
    "const client = __requireModule(\"client\");",
    "const uiBlocks = __requireModule(\"uiBlocks\");",
    "",
    "module.exports = Object.freeze({",
    "  LEGAL_TRANSITIONS: runStateMachine.LEGAL_TRANSITIONS,",
    "  TERMINAL_STATUSES: runStateMachine.TERMINAL_STATUSES,",
    "  createRunState: runStateMachine.createRunState,",
    "  isTerminalStatus: runStateMachine.isTerminalStatus,",
    "  reduceRunEvent: runStateMachine.reduceRunEvent,",
    "  classifyHttpFailure: client.classifyHttpFailure,",
    "  createAgentRunClient: client.createAgentRunClient,",
    "  createMemoryStorage: client.createMemoryStorage,",
    "  createPollingTransport: client.createPollingTransport,",
    "  UI_BLOCK_TYPES: uiBlocks.UI_BLOCK_TYPES,",
    "  normalizeUiBlocks: uiBlocks.normalizeUiBlocks,",
    "  blocksFromAgentResult: uiBlocks.blocksFromAgentResult,",
    "});",
    "",
  ].join("\n"));
  return parts.join("\n");
}

const generated = render();
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== generated.replace(/\r\n/g, "\n")) {
    console.error("agent sdk client artifact is out of date");
    process.exit(1);
  }
  console.log("agent sdk client artifact is current");
} else {
  fs.writeFileSync(outputPath, generated, "utf8");
  console.log(`generated ${path.relative(root, outputPath)}`);
}
