const assert = require("assert");

function loadFresh() {
  const resolved = require.resolve("../server/src/services/adminCapabilitiesService");
  delete require.cache[resolved];
  return require(resolved);
}

// unset → empty
{
  delete process.env.FOSU_ADMIN_NEXT_WRITE_MODULES;
  const fresh = loadFresh();
  assert.deepStrictEqual(fresh.getWriteModuleList(), [], "unset must disable all Vue write modules");
}

// empty → empty
{
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "";
  const fresh = loadFresh();
  assert.deepStrictEqual(fresh.getWriteModuleList(), []);
}

// explicit list
{
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "content,feedback";
  process.env.NODE_ENV = "test";
  const fresh = loadFresh();
  assert.deepStrictEqual(fresh.getWriteModuleList().sort(), ["content", "feedback"]);
  assert.strictEqual(fresh.resolveModuleForPath("/notices"), "content");
  assert.strictEqual(fresh.resolveModuleForPath("/backups/preflight"), "backups");

  const blocked = fresh.assertNextWriteAllowed({
    method: "POST",
    get: (h) => (String(h).toLowerCase() === "x-fosu-admin-client" ? "next" : ""),
    route: { path: "/config" },
    originalUrl: "/api/admin/config",
  });
  assert.strictEqual(blocked.ok, false);

  const allowed = fresh.assertNextWriteAllowed({
    method: "POST",
    get: (h) => (String(h).toLowerCase() === "x-fosu-admin-client" ? "next" : ""),
    route: { path: "/notices" },
    originalUrl: "/api/admin/notices",
  });
  assert.strictEqual(allowed.ok, true);

  const unknown = fresh.assertNextWriteAllowed({
    method: "POST",
    get: (h) => (String(h).toLowerCase() === "x-fosu-admin-client" ? "next" : ""),
    route: { path: "/unknown-write" },
    originalUrl: "/api/admin/unknown-write",
  });
  assert.strictEqual(unknown.ok, false);

  const legacy = fresh.assertNextWriteAllowed({
    method: "POST",
    get: () => "",
    route: { path: "/config" },
    originalUrl: "/api/admin/config",
  });
  assert.strictEqual(legacy.ok, true, "legacy not gated");
}

// settings write routes must be covered by the same route-to-module source as the gate.
{
  process.env.NODE_ENV = "test";
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "catalog,quality,settings";
  const fresh = loadFresh();
  const nextReq = (method, routePath) => ({
    method,
    get: (h) => (String(h).toLowerCase() === "x-fosu-admin-client" ? "next" : ""),
    route: { path: routePath },
    originalUrl: `/api/admin${routePath}`,
  });

  assert.strictEqual(fresh.resolveModuleForPath("/settings"), "settings");
  assert.strictEqual(fresh.resolveModuleForPath("/settings/preview"), "settings");
  assert.strictEqual(fresh.resolveModuleForPath("/unknown-write"), null);
  assert.strictEqual(fresh.assertNextWriteAllowed(nextReq("POST", "/settings")).ok, true);
  assert.strictEqual(fresh.assertNextWriteAllowed(nextReq("POST", "/unknown-write")).ok, false);
}

// production forbids *
{
  process.env.NODE_ENV = "production";
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "*";
  const fresh = loadFresh();
  let threw = false;
  try {
    fresh.assertWriteModulesConfigSafe();
  } catch (e) {
    threw = e.code === "WRITE_MODULES_STAR_FORBIDDEN";
  }
  assert.ok(threw, "production * must fail");
}

// Existing Phase B production writes remain enabled; C1 writes remain disabled.
{
  process.env.NODE_ENV = "production";
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "content,feedback,audit,backups,catalog,quality,settings";
  const fresh = loadFresh();
  assert.deepStrictEqual(
    fresh.getWriteModuleList().sort(),
    ["audit", "backups", "content", "feedback"],
    "production must retain only proven Phase B modules",
  );
  const map = fresh.getWriteModulesMap();
  assert.strictEqual(map.content, true);
  assert.strictEqual(map.feedback, true);
  assert.strictEqual(map.audit, true);
  assert.strictEqual(map.backups, true);
  assert.strictEqual(map.catalog, false);
  assert.strictEqual(map.quality, false);
  assert.strictEqual(map.settings, false);
}

// non-production allows * for tests
{
  process.env.NODE_ENV = "development";
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "*";
  const fresh = loadFresh();
  const list = fresh.getWriteModuleList();
  assert.ok(list.includes("content") && list.includes("release"));
}

delete process.env.FOSU_ADMIN_NEXT_WRITE_MODULES;
process.env.NODE_ENV = "test";
console.log("Admin capabilities tests passed.");
