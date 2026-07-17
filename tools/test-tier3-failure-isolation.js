const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Domain modules must load with try/catch so failures don't kill admin.js
const adminJs = fs.readFileSync(path.join(__dirname, "../server/src/routes/admin.js"), "utf8");
assert(adminJs.includes("optional domain modules failed to load"), "admin domain module load must be fail-open");

// Experimental pages must not import provider/ai runtime into shell bootstrap path
const mainTs = fs.readFileSync(path.join(__dirname, "../admin-web/src/main.ts"), "utf8");
assert(!/provider|assistant|knowledge/i.test(mainTs), "main bootstrap must not hard-depend on tier3 features");

const experimental = fs.readFileSync(path.join(__dirname, "../admin-web/src/pages/ExperimentalPage.vue"), "utf8");
assert(experimental.includes("Tier 3"), "experimental page documents isolation");

// AI services are under services/ai and should not be required by runtime pointer
const pointer = fs.readFileSync(path.join(__dirname, "../server/src/services/runtimePointerService.js"), "utf8");
assert(!pointer.includes("services/ai"), "runtime pointer must not depend on AI services");

console.log("Tier 3 failure isolation tests passed.");
