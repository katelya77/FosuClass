const assert = require("assert");
const path = require("path");

// Isolate module load with controlled env
function loadService(envPatch) {
  const prev = { ...process.env };
  Object.assign(process.env, envPatch);
  const resolved = require.resolve("../server/src/services/adminCapabilitiesService");
  delete require.cache[resolved];
  const mod = require(resolved);
  // restore
  for (const key of Object.keys(process.env)) {
    if (!(key in prev)) delete process.env[key];
  }
  Object.assign(process.env, prev);
  delete require.cache[resolved];
  return mod;
}

{
  const svc = loadService({ FOSU_ADMIN_NEXT_WRITE_MODULES: undefined });
  // re-require clean
  delete require.cache[require.resolve("../server/src/services/adminCapabilitiesService")];
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = undefined;
  delete process.env.FOSU_ADMIN_NEXT_WRITE_MODULES;
  const fresh = require("../server/src/services/adminCapabilitiesService");
  const list = fresh.getWriteModuleList();
  assert.ok(list.includes("content"), "default includes content");
  assert.ok(list.includes("feedback"));
  assert.ok(list.includes("backups"));
  assert.ok(!list.includes("release"), "default must not include release");
}

{
  delete require.cache[require.resolve("../server/src/services/adminCapabilitiesService")];
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "";
  const fresh = require("../server/src/services/adminCapabilitiesService");
  assert.deepStrictEqual(fresh.getWriteModuleList(), []);
}

{
  delete require.cache[require.resolve("../server/src/services/adminCapabilitiesService")];
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "content,feedback";
  const fresh = require("../server/src/services/adminCapabilitiesService");
  assert.deepStrictEqual(fresh.getWriteModuleList().sort(), ["content", "feedback"]);
  assert.strictEqual(fresh.resolveModuleForPath("/notices"), "content");
  assert.strictEqual(fresh.resolveModuleForPath("/feedbacks/1"), "feedback");
  assert.strictEqual(fresh.resolveModuleForPath("/backups/preflight"), "backups");

  const blocked = fresh.assertNextWriteAllowed({
    method: "POST",
    get: (h) => (String(h).toLowerCase() === "x-fosu-admin-client" ? "next" : ""),
    route: { path: "/config" },
    originalUrl: "/api/admin/config",
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, "MODULE_WRITE_DISABLED");

  const allowed = fresh.assertNextWriteAllowed({
    method: "POST",
    get: (h) => (String(h).toLowerCase() === "x-fosu-admin-client" ? "next" : ""),
    route: { path: "/notices" },
    originalUrl: "/api/admin/notices",
  });
  assert.strictEqual(allowed.ok, true);

  const legacy = fresh.assertNextWriteAllowed({
    method: "POST",
    get: () => "",
    route: { path: "/config" },
    originalUrl: "/api/admin/config",
  });
  assert.strictEqual(legacy.ok, true, "legacy client not gated");
}

{
  delete require.cache[require.resolve("../server/src/services/adminCapabilitiesService")];
  delete process.env.FOSU_ADMIN_NEXT_WRITE_MODULES;
  const fresh = require("../server/src/services/adminCapabilitiesService");
  const caps = fresh.getCapabilities();
  assert.strictEqual(caps.success, true);
  assert.ok(caps.writeModules.content === true || caps.writeModules.content === false);
  assert.ok(Array.isArray(caps.writeModuleList));
}

console.log("Admin capabilities tests passed.");
