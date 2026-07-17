/**
 * Phase B browser-oriented write flows via Playwright request context
 * against an isolated temp storage server.
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

async function loadPlaywright() {
  const candidates = [
    path.join(ROOT, "admin-web/node_modules/playwright"),
    path.join(ROOT, "node_modules/playwright"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return require(c);
    } catch {
      /* next */
    }
  }
  try {
    return require("playwright");
  } catch {
    return null;
  }
}

async function main() {
  const pw = await loadPlaywright();
  if (!pw) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "playwright not installed" }));
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-pw-b-"));
  const storageDir = path.join(tmp, "storage");
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
  fs.writeFileSync(path.join(storageDir, "notices.json"), "[]");
  fs.writeFileSync(path.join(storageDir, "news.json"), "[]");
  fs.writeFileSync(
    path.join(storageDir, "feedbacks.json"),
    JSON.stringify(
      [
        {
          id: "pw-fb-1",
          content: "playwright feedback body",
          status: "open",
          type: "bug",
          createdAt: new Date().toISOString(),
        },
      ],
      null,
      2
    )
  );

  process.env.NODE_ENV = "test";
  process.env.PORT = "0";
  process.env.FOSU_STORAGE_DIR = storageDir;
  process.env.FOSU_DATA_DIR = dataDir;
  process.env.ADMIN_PASSWORD = "pw-test-password-xyz";
  process.env.ADMIN_API_TOKEN = "pw-test-token-xyz-123456";
  process.env.FOSU_ADMIN_NEXT_ENABLED = "true";
  process.env.FOSU_ADMIN_PRIMARY = "legacy";
  process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "content,feedback,audit,backups";
  process.env.FOSU_CONFIG_HARD_FAIL = "false";
  process.env.FOSU_RELEASE_WORKER_ENABLED = "false";
  process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1,http://localhost";
  process.env.FOSU_ALLOWED_ADMIN_ORIGINS = "http://127.0.0.1,http://localhost";

  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}server${path.sep}src${path.sep}`)) delete require.cache[key];
  }

  const app = require("../server/src/app");
  const server = http.createServer(app);
  // If app.js already listened on 0, close and reuse handler
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;

  const { chromium } = pw;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: base });
  const results = [];

  try {
    const login = await context.request.post(`${base}/api/admin/login`, {
      data: { password: process.env.ADMIN_PASSWORD },
    });
    assert.strictEqual(login.status(), 200, await login.text());
    const loginBody = await login.json();
    const csrf = loginBody.csrfToken || (loginBody.data && loginBody.data.csrfToken);
    assert.ok(csrf);
    results.push("login");

    async function api(method, urlPath, data, headers = {}) {
      const opts = {
        headers: {
          "X-Fosu-CSRF": csrf,
          "X-Fosu-Admin-Client": "next",
          ...headers,
        },
      };
      if (data !== undefined) opts.data = data;
      const res = await context.request.fetch(`${base}${urlPath}`, {
        method,
        ...opts,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      return { status: res.status(), json, text };
    }

    const created = await api("POST", "/api/admin/notices", {
      title: "PW Notice",
      content: "hello",
      enabled: true,
    });
    assert.strictEqual(created.status, 200, created.text);
    results.push("content-create");
    const id = created.json.item.id;
    const v1 = created.json.item.version;

    const edited = await api(
      "PUT",
      `/api/admin/notices/${id}`,
      { title: "PW Notice 2", content: "hello", enabled: false, expectedVersion: v1 },
      { "If-Match": v1 }
    );
    assert.strictEqual(edited.status, 200, edited.text);
    results.push("content-edit-toggle");

    const conflict = await api(
      "PUT",
      `/api/admin/notices/${id}`,
      { title: "stale", expectedVersion: v1 },
      { "If-Match": v1 }
    );
    assert.strictEqual(conflict.status, 409);
    results.push("content-409");

    const missing = await api("PUT", `/api/admin/notices/${id}`, { title: "no match" });
    assert.strictEqual(missing.status, 428);
    results.push("content-428");

    const news = await api("POST", "/api/admin/news", { title: "PW News", summary: "s", enabled: true });
    assert.strictEqual(news.status, 200, news.text);
    results.push("news-create");

    const fb = await api("PUT", "/api/admin/feedbacks/pw-fb-1", {
      status: "resolved",
      adminNote: "done",
    });
    assert.strictEqual(fb.status, 200, fb.text);
    results.push("feedback-update");

    const audit = await api("GET", "/api/admin/audit-logs");
    assert.strictEqual(audit.status, 200);
    assert.ok(Array.isArray(audit.json.items));
    results.push("audit-list");

    const bname = "notices-20260718-111111.json";
    fs.writeFileSync(
      path.join(dataDir, "backups", bname),
      JSON.stringify([{ id: "x", title: "bak" }], null, 2)
    );
    const dry = await api("POST", "/api/admin/backups/restore", {
      filename: bname,
      dryRun: true,
      confirm: bname,
      idempotencyKey: "pw-dry",
    });
    assert.strictEqual(dry.status, 200, dry.text);
    assert.strictEqual(dry.json.dryRun, true);
    results.push("backup-dry-run");

    const del = await api("DELETE", `/api/admin/notices/${id}`);
    assert.strictEqual(del.status, 200, del.text);
    results.push("content-delete");

    // Optional SPA open (assets may 200 even if not authenticated UI)
    const page = await context.newPage();
    const spa = await page.goto(`${base}/admin-next/content`, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    if (spa) results.push("spa-content-route");
    await page.close();

    console.log(JSON.stringify({ ok: true, results, base }, null, 2));
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
    // app.js may have opened its own listener on PORT=0; force exit after tests
    setTimeout(() => process.exit(0), 50);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
