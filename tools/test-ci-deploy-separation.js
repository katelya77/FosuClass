#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, ".github", "workflows", name), "utf8");

for (const name of ["deploy-vps.yml", "container-publish.yml", "agent-platform-publish.yml"]) {
  const workflow = read(name);
  const triggerBlock = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("jobs:"));
  assert(triggerBlock.includes("workflow_dispatch:"), `${name} must remain manually dispatched`);
  assert(!/^\s{2}push:/m.test(triggerBlock), `${name} must not publish or deploy on push`);
  assert(!/^\s{2}pull_request:/m.test(triggerBlock), `${name} must not publish or deploy on PR`);
}

const ci = read("xiaofu-agent-ci.yml");
assert(/^\s{2}pull_request:/m.test(ci), "agent CI should continue validating pull requests");
assert(/^\s{2}push:/m.test(ci), "agent CI should continue validating main pushes");
assert(!/appleboy\/(?:ssh|scp)-action/.test(ci), "agent CI must not deploy to a VPS");
assert(!/docker\/(?:build-push|metadata)-action/.test(ci), "agent CI must not publish containers");

console.log("CI/deploy separation: PASS");
