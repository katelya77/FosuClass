const assert = require("assert");
const fs = require("fs");
const path = require("path");
const wxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.wxml"), "utf8");
const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
assert.ok(wxml.includes('day-count="7"'));
assert.ok(page.includes("周六"));
assert.ok(page.includes("周日"));
console.log("personal sync seven day preview ok");
