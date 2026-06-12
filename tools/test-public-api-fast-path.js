const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const releaseService = fs.readFileSync(path.join(root, "server/src/services/releaseService.js"), "utf-8");
const appConfig = fs.readFileSync(path.join(root, "server/src/services/appConfigService.js"), "utf-8");
const fosuRoutes = fs.readFileSync(path.join(root, "server/src/routes/fosu.js"), "utf-8");

function functionBody(source, name) {
  const index = source.indexOf(`function ${name}`);
  assert(index >= 0, `${name} should exist`);
  const next = source.indexOf("\nfunction ", index + 10);
  return source.slice(index, next > index ? next : source.length);
}

const fastBody = functionBody(releaseService, "getActiveReleaseInfoFast");
assert(!/getReleasePackStatus|collectJsonFiles|readReleaseSnapshot|readActiveReleaseSnapshot/.test(fastBody), "fast active release info must not deep scan or read snapshots");
assert(/compactReleaseManifest/.test(fastBody), "fast active release info should expose compact manifest metadata");
assert(/getActiveReleaseInfo\(\)[\s\S]*getActiveReleaseInfoFast\(\)/.test(releaseService), "getActiveReleaseInfo should delegate to fast path");
assert(/function getReleaseStatusFast/.test(releaseService), "releaseService should expose fast release status for public API");
assert(!/readActiveReleaseSnapshot\(\)/.test(appConfig), "app-config must not parse active snapshot");
assert(!/getReleaseStatus\(\)/.test(appConfig), "app-config must not call deep release status");
["/runtime/active", "/app-config", "/bootstrap", "/prefetch", "/periodic-data", "/terms"].forEach((route) => {
  assert(fosuRoutes.includes(route), `${route} route should exist`);
});
assert(/readActivePointer\(\)/.test(fosuRoutes), "runtime route should read the small runtime pointer");

console.log("test-public-api-fast-path passed");
