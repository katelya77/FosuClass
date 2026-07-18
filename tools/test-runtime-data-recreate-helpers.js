const assert = require("assert");
const path = require("path");

const {
  buildComposeDocument,
  validateExpectedMounts,
} = require("./test-runtime-data-recreate");

const document = buildComposeDocument("fosuclass-persistence:test");
assert.match(document, /image:\s+fosuclass-persistence:test/);
assert.match(document, /\.\/data:\/app\/data/);
assert.match(document, /\.\/storage:\/app\/storage/);
assert.match(document, /FOSU_RUNTIME_DATA_REQUIRE_MIGRATION:\s*"true"/);
assert.ok(!/^\s+build:/m.test(document));

const root = path.resolve("fixture-root");
const mounts = [
  { Type: "bind", Source: path.join(root, "data"), Destination: "/app/data", RW: true },
  { Type: "bind", Source: path.join(root, "storage"), Destination: "/app/storage", RW: true },
];
assert.deepStrictEqual(validateExpectedMounts(mounts, root), { ok: true, destinations: ["/app/data", "/app/storage"] });
assert.throws(
  () => validateExpectedMounts(mounts.slice(0, 1), root),
  (error) => error && error.code === "RUNTIME_RECREATE_MOUNT_INVALID"
);

console.log(JSON.stringify({ ok: true, helperContract: "verified" }, null, 2));
