const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(root, "server", "Dockerfile"), "utf8");

assert.match(
  dockerfile,
  /^COPY tools\/lib\/admin-rollout-manifest\.js \.\/tools\/lib\/admin-rollout-manifest\.js$/m,
  "final runtime must copy the rollout manifest loader to /app/tools/lib",
);
assert.match(
  dockerfile,
  /^COPY config\/admin-rollout-manifest\.json \.\/config\/admin-rollout-manifest\.json$/m,
  "final runtime must copy the rollout manifest to /app/config",
);

console.log("Admin rollout runtime Docker contract passed.");
