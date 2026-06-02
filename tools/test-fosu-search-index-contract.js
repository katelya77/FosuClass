const assert = require("assert");
const fs = require("fs");
const path = require("path");
const express = require("../server/node_modules/express");
const fosuRouter = require("../server/src/routes/fosu");
const releaseService = require("../server/src/services/releaseService");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function getJson(baseUrl, path) {
  const start = Date.now();
  const response = await fetch(`${baseUrl}${path}`);
  const data = await response.json();
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") || "",
    durationMs: Date.now() - start,
    data,
  };
}

async function run() {
  let tempActive = false;
  let activeInfo = releaseService.getActiveReleaseInfo();
  if (!activeInfo || !activeInfo.releaseVersion) {
    const bundledVersion = "26.05.29.22";
    const bundledDir = path.join(__dirname, "../server/storage/releases", bundledVersion);
    if (!fs.existsSync(bundledDir)) {
      console.warn("test-fosu-search-index-contract skipped: no active release");
      return;
    }
    fs.writeFileSync(releaseService.ACTIVE_RELEASE_PATH, JSON.stringify({
      version: bundledVersion,
      releaseVersion: bundledVersion,
      semester: "2025-2026-2",
      activatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, null, 2));
    tempActive = true;
    activeInfo = releaseService.getActiveReleaseInfo();
  }

  const app = express();
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const noVersion = await getJson(baseUrl, "/api/fosu/search-index?type=class");
    assert.strictEqual(noVersion.status, 200);
    assert(noVersion.cacheControl.includes("no-store"), "search-index without releaseVersion must be no-store");
    assert.strictEqual(noVersion.data.success, true);
    const releaseVersion = noVersion.data.releaseVersion || (noVersion.data.meta && noVersion.data.meta.releaseVersion) || activeInfo.releaseVersion;
    const term = noVersion.data.term || (noVersion.data.meta && noVersion.data.meta.term) || activeInfo.term || "2025-2026-2";

    for (const type of ["class", "teacher", "classroom", "course"]) {
      const result = await getJson(baseUrl, `/api/fosu/search-index?term=${encodeURIComponent(term)}&releaseVersion=${encodeURIComponent(releaseVersion)}&type=${type}`);
      assert.strictEqual(result.status, 200);
      assert(result.cacheControl.includes("public") && result.cacheControl.includes("max-age"), `${type} should be cacheable with releaseVersion`);
      assert.strictEqual(result.data.success, true, `${type} success`);
      assert.strictEqual(result.data.term, term);
      assert.strictEqual(result.data.releaseVersion, releaseVersion);
      assert(Array.isArray(result.data.items), `${type} items array`);
      assert.strictEqual(typeof result.data.total, "number", `${type} total number`);
      assert(result.data.total > 0, `${type} total should be positive`);
      assert(result.durationMs < 2000, `${type} should read lightweight index quickly`);
      console.log(`[test] ${type} search-index total=${result.data.total} duration=${result.durationMs}ms cache=${result.cacheControl}`);
    }
  } finally {
    server.close();
    if (tempActive && fs.existsSync(releaseService.ACTIVE_RELEASE_PATH)) {
      fs.unlinkSync(releaseService.ACTIVE_RELEASE_PATH);
    }
  }

  console.log("test-fosu-search-index-contract passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
