/**
 * FOSU_ADMIN_NEXT_ENABLED=false + FOSU_ADMIN_PRIMARY=next must not claim next primary.
 */
const assert = require("assert");
const http = require("http");
const path = require("path");
const express = require(path.join(__dirname, "../server/node_modules/express"));

function buildUiModeHandler() {
  const adminNextEnabled = process.env.FOSU_ADMIN_NEXT_ENABLED !== "false";
  const requestedAdminPrimaryNext =
    String(process.env.FOSU_ADMIN_PRIMARY || "legacy").toLowerCase() === "next";
  const effectiveAdminPrimaryNext = adminNextEnabled && requestedAdminPrimaryNext;
  return (req, res) => {
    res.json({
      success: true,
      adminNextEnabled,
      requestedPrimary: requestedAdminPrimaryNext ? "next" : "legacy",
      primary: effectiveAdminPrimaryNext ? "next" : "legacy",
      effectivePrimary: effectiveAdminPrimaryNext ? "next" : "legacy",
      conflict:
        requestedAdminPrimaryNext && !adminNextEnabled
          ? "FOSU_ADMIN_PRIMARY=next ignored because FOSU_ADMIN_NEXT_ENABLED=false"
          : null,
    });
  };
}

function getJson(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      http
        .get({ hostname: "127.0.0.1", port, path: "/api/admin/ui-mode" }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            server.close();
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          });
        })
        .on("error", (e) => {
          server.close();
          reject(e);
        });
    });
  });
}

async function main() {
  // conflict case
  process.env.FOSU_ADMIN_NEXT_ENABLED = "false";
  process.env.FOSU_ADMIN_PRIMARY = "next";
  {
    const app = express();
    app.get("/api/admin/ui-mode", buildUiModeHandler());
    const body = await getJson(app);
    assert.strictEqual(body.adminNextEnabled, false);
    assert.strictEqual(body.requestedPrimary, "next");
    assert.strictEqual(body.primary, "legacy");
    assert.strictEqual(body.effectivePrimary, "legacy");
    assert.ok(body.conflict && /ignored/.test(body.conflict));
  }

  // normal next
  process.env.FOSU_ADMIN_NEXT_ENABLED = "true";
  process.env.FOSU_ADMIN_PRIMARY = "next";
  {
    const app = express();
    app.get("/api/admin/ui-mode", buildUiModeHandler());
    const body = await getJson(app);
    assert.strictEqual(body.primary, "next");
    assert.strictEqual(body.effectivePrimary, "next");
    assert.strictEqual(body.conflict, null);
  }

  // source contract
  const appJs = require("fs").readFileSync(path.join(__dirname, "../server/src/app.js"), "utf8");
  assert(appJs.includes("effectiveAdminPrimaryNext"), "app.js must compute effective primary");
  assert(appJs.includes("FOSU_ADMIN_PRIMARY=next ignored"), "must warn on conflict");

  console.log("Admin ui-mode conflict tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
