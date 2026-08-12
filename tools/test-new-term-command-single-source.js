"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const serverWrapper = fs.readFileSync(path.join(__dirname, "../server/scripts/sync-new-term.js"), "utf8");
assert(pkg.scripts["sync:current-term"], "root must expose the only operator-facing current-term command");
assert(pkg.scripts.login, "root must expose one login command");
assert(!serverWrapper.includes("2026-09-01"));
assert(!serverWrapper.includes("function parseArgs"));
assert(serverWrapper.includes("current-term"), "legacy wrapper must delegate to current-term entrypoint");
console.log("test-new-term-command-single-source passed");
