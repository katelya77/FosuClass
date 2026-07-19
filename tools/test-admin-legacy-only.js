const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

function assertRepositoryNoLongerBuildsAdminNext() {
  assert.strictEqual(fs.existsSync(path.join(ROOT, "admin-web")), false, "admin-web must be removed");
  assert.strictEqual(
    fs.existsSync(path.join(ROOT, "server", "public", "admin-app")),
    false,
    "server/public/admin-app must be removed",
  );

  const packageJson = JSON.parse(read("package.json"));
  ["admin:dev", "admin:build", "admin:preview", "admin:test", "admin:test:e2e", "admin:test:browser"]
    .forEach((script) => assert.strictEqual(packageJson.scripts[script], undefined, `${script} must be removed`));

  const dockerfile = read("server/Dockerfile");
  ["admin-web", "admin-builder", "admin-app"].forEach((needle) => {
    assert.strictEqual(dockerfile.includes(needle), false, `Dockerfile must not reference ${needle}`);
  });

  const appSource = read("server/src/app.js");
  ["ADMIN_APP_DIR", "sendAdminSpa", "FOSU_ADMIN_PRIMARY", "express.static(ADMIN_APP_DIR"].forEach((needle) => {
    assert.strictEqual(appSource.includes(needle), false, `server/src/app.js must not reference ${needle}`);
  });

  [
    "server/src/modules/content",
    "server/src/modules/settings",
    "server/src/modules/catalog",
    "server/src/modules/quality",
    "server/src/services/adminAuditService.js",
    "server/src/services/backupService.js",
    "server/src/services/adminCapabilitiesService.js",
  ].forEach((relativePath) => {
    assert.strictEqual(fs.existsSync(path.join(ROOT, relativePath)), true, `shared backend must remain: ${relativePath}`);
  });
}

async function assertLegacyOnlyRuntimeRouting() {
  const harness = await startAdminHttpHarness({
    environment: {
      PORT: "3001",
      FOSU_ADMIN_NEXT_ENABLED: "true",
      FOSU_ADMIN_PRIMARY: "next",
    },
  });
  try {
    const uiMode = await harness.request("/api/admin/ui-mode");
    assert.strictEqual(uiMode.status, 200, uiMode.text);
    assert.deepStrictEqual(uiMode.json, {
      success: true,
      primary: "legacy",
      effectivePrimary: "legacy",
      adminNextEnabled: false,
      paths: { legacy: "/admin/" },
    });

    const capabilities = await harness.request("/api/admin/capabilities");
    assert.strictEqual(capabilities.status, 200, capabilities.text);
    assert.strictEqual(capabilities.json.primary, "legacy");
    assert.strictEqual(capabilities.json.requestedPrimary, "legacy");
    assert.strictEqual(capabilities.json.nextEnabled, false);
    assert.strictEqual(capabilities.json.legacyEnabled, true);
    assert.deepStrictEqual(capabilities.json.paths, { legacy: "/admin/" });

    const login = await harness.request("/admin/login");
    assert.strictEqual(login.status, 200, login.text);
    assert.match(login.text, /Admin Console|FosuClass/);

    const sync = await harness.request("/admin/sync");
    assert.strictEqual(sync.status, 302, sync.text);
    assert.match(sync.headers.location || "", /^\/admin\/login\?next=/);

    const nextAlias = await harness.request("/admin-next/sync?from=bookmark");
    assert.strictEqual(nextAlias.status, 302, nextAlias.text);
    assert.strictEqual(nextAlias.headers.location, "/admin/sync?from=bookmark");

    const legacyAlias = await harness.request("/admin-legacy/sync?from=bookmark");
    assert.strictEqual(legacyAlias.status, 302, legacyAlias.text);
    assert.strictEqual(legacyAlias.headers.location, "/admin/sync?from=bookmark");
  } finally {
    await harness.close();
  }
}

async function main() {
  assertRepositoryNoLongerBuildsAdminNext();
  await assertLegacyOnlyRuntimeRouting();
  console.log("Legacy-only admin routing and dependency guards passed.");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
