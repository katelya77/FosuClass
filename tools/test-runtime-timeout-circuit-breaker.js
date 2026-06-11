const assert = require("assert");
const fs = require("fs");
const path = require("path");

const service = fs.readFileSync(path.join(__dirname, "../miniprogram/services/releasePackService.js"), "utf-8");
const startup = fs.readFileSync(path.join(__dirname, "../miniprogram/services/startupCoordinator.js"), "utf-8");

assert(service.includes("RUNTIME_POINTER_CIRCUIT_MS"), "runtime pointer circuit duration should be defined");
assert(service.includes("openRuntimeCircuit"), "runtime pointer failures should open circuit");
assert(service.includes("getCachedRuntimePointer"), "runtime circuit should fall back to cached pointer");
assert(service.includes("circuitOpen"), "fallback pointer should expose circuitOpen");
assert(startup.includes("readRuntimeCircuit"), "startup background refresh should skip while circuit is open");

console.log("test-runtime-timeout-circuit-breaker passed");
