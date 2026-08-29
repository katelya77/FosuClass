#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { workflows, renderWorkflowMarkdown } = require("./workflow-definitions");

const root = __dirname;
const outputs = new Map();
outputs.set(
  path.join(root, "workflow-specs.json"),
  `${JSON.stringify({ schema: "campus-adp-workflows/v2", workflows }, null, 2)}\n`,
);
for (const workflow of workflows) {
  outputs.set(path.join(root, `${workflow.name}.md`), `${renderWorkflowMarkdown(workflow)}\n`);
}

const checkOnly = process.argv.includes("--check");
let changed = 0;
for (const [file, content] of outputs) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current === content) continue;
  changed += 1;
  if (!checkOnly) fs.writeFileSync(file, content, "utf8");
  else console.error(`[fail] 工作流资产过期：${path.basename(file)}`);
}

if (checkOnly && changed) process.exit(1);
console.log(`[${checkOnly ? "pass" : "ok"}] workflows=${workflows.length} nodes=${workflows.map((item) => item.nodeCount).join("/")}`);
