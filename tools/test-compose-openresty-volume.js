const assert = require("assert");
const fs = require("fs");
const path = require("path");

const compose = fs.readFileSync(path.join(__dirname, "..", "server", "docker-compose.yml"), "utf-8");

assert(compose.includes("env_file:"), "compose should use env_file");
assert(compose.includes("- .env"), "compose should load server/.env");
assert(compose.includes("./storage:/app/storage"), "compose should keep storage volume");
assert(
  compose.includes("${OPENRESTY_HOST_RELEASE_DIR:-/opt/1panel/www/sites/class.katelya.eu.org/index/static/releases}:/openresty-static/releases"),
  "compose should mount OpenResty static release directory with safe default"
);
assert(
  compose.includes("${OPENRESTY_HOST_RUNTIME_DIR:-/opt/1panel/www/sites/class.katelya.eu.org/index/static/runtime}:/openresty-static/runtime"),
  "compose should mount OpenResty static runtime directory with safe default"
);
assert(compose.includes("127.0.0.1"), "compose should keep local host port binding default");
assert(compose.includes("healthcheck:"), "compose should keep healthcheck");
assert(compose.includes("restart: unless-stopped"), "compose should keep restart policy");

console.log("test-compose-openresty-volume passed");
