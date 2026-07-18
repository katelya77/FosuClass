const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(root, "server", "Dockerfile"), "utf8");
const serviceFile = path.join(root, "server", "src", "services", "adminCapabilitiesService.js");
const loaderFile = path.join(root, "server", "src", "services", "adminRolloutManifestService.js");
const serviceSource = fs.readFileSync(serviceFile, "utf8");

assert.match(
  serviceSource,
  /require\("\.\/adminRolloutManifestService"\)/,
  "capabilities service must use the server-owned manifest loader",
);
assert.match(
  dockerfile,
  /^COPY config\/admin-rollout-manifest\.json \.\/config\/admin-rollout-manifest\.json$/m,
  "final runtime must copy the rollout manifest to /app/config",
);
assert.doesNotMatch(
  dockerfile,
  /^COPY tools\/lib\/admin-rollout-manifest\.js /m,
  "final runtime must not copy a repository-root tools dependency",
);
assert.ok(fs.existsSync(loaderFile), "server-owned manifest loader must exist");

const finalImageFiles = new Set([
  "/app/src/services/adminCapabilitiesService.js",
  "/app/src/services/adminRolloutManifestService.js",
  "/app/config/admin-rollout-manifest.json",
]);
const serviceImportTarget = path.posix.resolve(
  path.posix.dirname("/app/src/services/adminCapabilitiesService.js"),
  "./adminRolloutManifestService.js",
);
const loaderManifestTarget = path.posix.resolve("/app", "config/admin-rollout-manifest.json");
assert.ok(finalImageFiles.has(serviceImportTarget), "final image must contain the service import target");
assert.ok(finalImageFiles.has(loaderManifestTarget), "final image must contain the loader manifest target");
assert.strictEqual(
  require(loaderFile).RUNTIME_MANIFEST_PATH,
  loaderManifestTarget,
  "server loader must resolve its production manifest target inside the final image layout",
);

console.log("Admin rollout runtime Docker contract passed.");
