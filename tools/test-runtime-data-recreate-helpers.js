const assert = require("assert");
const path = require("path");

const {
  buildComposeDocument,
  buildShadowComposeOverride,
  validateExpectedMounts,
  validateShadowIsolation,
} = require("./test-runtime-data-recreate");

const document = buildComposeDocument("fosuclass-persistence:test");
assert.match(document, /image:\s+fosuclass-persistence:test/);
assert.match(document, /\.\/data:\/app\/data/);
assert.match(document, /\.\/storage:\/app\/storage/);
assert.match(document, /FOSU_RUNTIME_DATA_REQUIRE_MIGRATION:\s*"true"/);
assert.ok(!/^\s+build:/m.test(document));

const root = path.resolve("fixture-root");
const shadowOverride = JSON.parse(buildShadowComposeOverride("verify", root));
assert.deepStrictEqual(shadowOverride.services.verify.volumes, [
  { type: "bind", source: path.join(root, "shadow-data"), target: "/app/data", read_only: false },
  { type: "bind", source: path.join(root, "storage"), target: "/app/storage", read_only: true },
  { type: "bind", source: path.join(root, "openresty-releases"), target: "/openresty-static/releases", read_only: true },
  { type: "bind", source: path.join(root, "openresty-runtime"), target: "/openresty-static/runtime", read_only: true },
]);
const mounts = [
  { Type: "bind", Source: path.join(root, "data"), Destination: "/app/data", RW: true },
  { Type: "bind", Source: path.join(root, "storage"), Destination: "/app/storage", RW: true },
];
assert.deepStrictEqual(validateExpectedMounts(mounts, root), { ok: true, destinations: ["/app/data", "/app/storage"] });
assert.throws(
  () => validateExpectedMounts(mounts.slice(0, 1), root),
  (error) => error && error.code === "RUNTIME_RECREATE_MOUNT_INVALID"
);

const shadow = {
  Config: { Image: "fosuclass-persistence:test" },
  Mounts: [
    { Type: "bind", Source: path.join(root, "shadow-data"), Destination: "/app/data", RW: true },
    { Type: "bind", Source: path.join(root, "storage"), Destination: "/app/storage", RW: false },
    { Type: "bind", Source: path.join(root, "openresty-releases"), Destination: "/openresty-static/releases", RW: false },
    { Type: "bind", Source: path.join(root, "openresty-runtime"), Destination: "/openresty-static/runtime", RW: false },
  ],
  NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] } },
};
assert.deepStrictEqual(validateShadowIsolation(shadow, root, "fosuclass-persistence:test"), {
  ok: true,
  hostIp: "127.0.0.1",
  hostPort: 49152,
});
assert.throws(
  () => validateShadowIsolation({ ...shadow, NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "49152" }] } } }, root, "fosuclass-persistence:test"),
  (error) => error && error.code === "RUNTIME_RECREATE_SHADOW_INVALID"
);
assert.throws(
  () => validateShadowIsolation({ ...shadow, Mounts: shadow.Mounts.map((mount) => mount.Destination === "/openresty-static/runtime" ? { ...mount, RW: true } : mount) }, root, "fosuclass-persistence:test"),
  (error) => error && error.code === "RUNTIME_RECREATE_SHADOW_INVALID"
);
assert.throws(
  () => validateShadowIsolation({ ...shadow, Mounts: shadow.Mounts.concat({ Type: "bind", Source: path.join(root, "unexpected"), Destination: "/unexpected", RW: true }) }, root, "fosuclass-persistence:test"),
  (error) => error && error.code === "RUNTIME_RECREATE_SHADOW_INVALID"
);
assert.throws(
  () => validateShadowIsolation({ ...shadow, NetworkSettings: { Ports: { ...shadow.NetworkSettings.Ports, "9222/tcp": [{ HostIp: "0.0.0.0", HostPort: "49222" }] } } }, root, "fosuclass-persistence:test"),
  (error) => error && error.code === "RUNTIME_RECREATE_SHADOW_INVALID"
);

console.log(JSON.stringify({ ok: true, helperContract: "verified" }, null, 2));
