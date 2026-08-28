#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexJs = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.js"), "utf8");
const indexWxml = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8");
const indexWxss = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxss"), "utf8");
const floatWxml = fs.readFileSync(path.join(root, "miniprogram/components/xiaofu-float/index.wxml"), "utf8");
const floatWxss = fs.readFileSync(path.join(root, "miniprogram/components/xiaofu-float/index.wxss"), "utf8");
const courseJs = fs.readFileSync(path.join(root, "miniprogram/utils/course.js"), "utf8");

const onLoadBody = (indexJs.match(/\bonLoad\(options\)\s*\{([\s\S]*?)\n\s*\},\n\n\s*onShow\(/) || [])[1] || "";
assert.ok(!/this\.loadSchedule\(\)/.test(onLoadBody), "onLoad and onShow must not both render the full schedule");

const axisZ = Number((indexWxss.match(/\.time-axis\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1] || 0);
const activeCourseZ = Number((courseJs.match(/course\.active\s*\?\s*(\d+)\s*\+/) || [])[1] || 0);
assert.ok(axisZ > activeCourseZ, `time axis z-index ${axisZ} must be above active course z-index ${activeCourseZ}`);
assert.ok(indexWxml.includes('class="time-axis-layer"'), "seven-day detail mode should render the time axis outside the horizontal day scroller");

assert.ok(/translate3d\(\{\{x\}\}px,\s*\{\{y\}\}px,\s*0\)/.test(floatWxml), "floating assistant movement should use compositor transforms");
assert.ok(!/will-change:\s*left,\s*top/.test(floatWxss), "floating assistant must not promote layout-changing left/top animation");
assert.ok(courseJs.includes("normalized: true"), "schedule columns should avoid normalizing every course once per weekday");

console.log("test-home-ui-performance passed");
