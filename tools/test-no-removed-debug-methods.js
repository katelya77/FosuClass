const assert = require("assert");
const fs = require("fs");
const path = require("path");

const schoolPath = path.join(__dirname, "../miniprogram/pages/school/school.js");
const source = fs.readFileSync(schoolPath, "utf-8");

assert(!source.includes("this.updateDebugRequestInfo"), "school.js must not call removed updateDebugRequestInfo");
assert(!/setData\s*\(\s*\{[\s\S]*?schoolNotice\s*:\s*undefined[\s\S]*?\}/.test(source), "schoolNotice must not be set to undefined");

const hasLoadingStateTimerCall = source.includes("this.startLoadingStateTimer(");
const hasLoadingStateTimerDefinition = /startLoadingStateTimer\s*\([^)]*\)\s*\{/.test(source);
assert(!hasLoadingStateTimerCall || hasLoadingStateTimerDefinition, "startLoadingStateTimer calls must have a page method definition");

assert(!source.includes("FOSU_SCHOOL_INDEX"), "legacy FOSU_SCHOOL_INDEX cache key must not remain");

console.log("test-no-removed-debug-methods passed");
