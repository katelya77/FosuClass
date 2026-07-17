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
