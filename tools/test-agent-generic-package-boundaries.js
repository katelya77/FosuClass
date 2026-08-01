#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const roots = [path.join(ROOT, "packages"), path.join(ROOT, "apps")];
const forbidden = /fosu|佛山大学|佛大|x-fosu|static\/releases|release-pack/i;
const violations = [];

function visit(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return visit(target);
    // .html 同样在边界内：apps/ 下的静态页面不得硬编码部署方字样（由注入覆盖）。
    if (!/\.(?:js|json|html)$/.test(entry.name)) return;
    const source = fs.readFileSync(target, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      if (forbidden.test(line)) {
        violations.push(`${path.relative(ROOT, target)}:${index + 1}: ${line.trim()}`);
      }
    });
  });
}

roots.forEach(visit);
assert.deepStrictEqual(
  violations,
  [],
  `generic Agent packages/apps must receive campus concerns by injection:\n${violations.join("\n")}`
);
console.log("test-agent-generic-package-boundaries: PASS");
