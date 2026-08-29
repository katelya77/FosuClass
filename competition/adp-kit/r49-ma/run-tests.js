#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = __dirname;
const files = fs.readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".js"))
  .sort()
  .map((name) => path.join("tests", name));

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
