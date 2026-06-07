const assert = require("assert");
const mockEnv = require("./mock-env");

const realURL = global.URL;
const realSetTimeout = global.setTimeout;
global.URL = undefined;

function wait(ms = 0) {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}

function latestCall(calls, matcher) {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (matcher(calls[index])) return calls[index];
  }
  return null;
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function installRequestMocks(state) {
  global.wx.login = (options) => {
    state.loginCalls += 1;
    realSetTimeout(() => options.success({ code: `wx-code-${state.loginCalls}` }), 0);
  };

  global.wx.mockRequest = (options) => {
    const record = {
      url: options.url,
      method: options.method || "GET",
      data: options.data || {},
      header: Object.assign({}, options.header || {}),
      timeout: options.timeout,
    };
    state.calls.push(record);

    if (state.failSessionOnceFor && String(options.url).indexOf(state.failSessionOnceFor) >= 0) {
      state.failSessionOnceFor = "";
      realSetTimeout(() => options.success({
        statusCode: 401,
        data: {
          success: false,
          code: "FOSU_SESSION_EXPIRED",
          reasonCode: "FOSU_SESSION_EXPIRED",
          message: "expired",
        },
      }), 0);
      return;
    }

    if (String(options.url).indexOf("/api/fosu/session/bootstrap") >= 0) {
      state.sessionBootstrapCalls += 1;
      realSetTimeout(() => options.success({
        statusCode: 200,
        data: {
          success: true,
          sessionToken: `session-token-${state.sessionBootstrapCalls}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          expiresIn: 3600,
          securityMode: "ticket",
          staticAccessMode: "ticket",
          serverTime: new Date().toISOString(),
        },
      }), 0);
      return;
    }

    if (String(options.url).indexOf("/api/fosu/static-access/bootstrap") >= 0) {
      state.staticBootstrapCalls += 1;
      realSetTimeout(() => options.success({
        statusCode: 200,
        data: {
          success: true,
          ticket: `static-ticket-${options.data && options.data.releaseVersion || "unknown"}`,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          headerName: "X-Fosu-Static-Ticket",
        },
      }), 0);
      return;
    }

    realSetTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        url: options.url,
        data: options.data || {},
        releaseVersion: options.data && options.data.releaseVersion || "url-compat-release",
        term: "2025-2026-2",
        items: [],
      },
    }), 0);
  };
}

async function runHeaderCompatibilityTests() {
  mockEnv.clearStorage();
  clearModule("../miniprogram/services/securitySessionService");
  clearModule("../miniprogram/services/staticAccessService");
  clearModule("../miniprogram/utils/request");
  clearModule("../miniprogram/utils/trustedUrl");

  const state = {
    calls: [],
    loginCalls: 0,
    sessionBootstrapCalls: 0,
    staticBootstrapCalls: 0,
  };
  installRequestMocks(state);

  const securitySessionService = require("../miniprogram/services/securitySessionService");
  const staticAccessService = require("../miniprogram/services/staticAccessService");
  const request = require("../miniprogram/utils/request");
  const trustedUrl = require("../miniprogram/utils/trustedUrl");

  assert.strictEqual(global.URL, undefined, "test must run without global URL");
  assert.strictEqual(trustedUrl.normalizeTrustedPath("/api/fosu/prefetch", "https://class.katelya.eu.org/", "/api/"), "/api/fosu/prefetch");
  assert.strictEqual(trustedUrl.normalizeTrustedPath("https://class.katelya.eu.org/api/fosu/prefetch", "https://class.katelya.eu.org/", "/api/"), "/api/fosu/prefetch");
  assert.strictEqual(securitySessionService.isTrustedApiUrl("/api/fosu/prefetch"), true);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("https://class.katelya.eu.org/api/fosu/prefetch"), true);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("https://class.katelya.eu.org/api/fosu/bootstrap?ts=123#hash"), true);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("https://evil.example/api/fosu/prefetch"), false);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("https://class.katelya.eu.org.evil.example/api/fosu/prefetch"), false);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("https://evil.example/?next=https://class.katelya.eu.org/api/fosu/prefetch"), false);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("//evil.example/api/fosu/prefetch"), false);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("javascript:alert(1)"), false);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("data:text/plain,hi"), false);
  assert.strictEqual(securitySessionService.isTrustedApiUrl("https://class.katelya.eu.org/not-api"), false);

  assert.strictEqual(securitySessionService.isBootstrapUrl("/api/fosu/session/bootstrap"), true);
  assert.strictEqual(securitySessionService.isBootstrapUrl("https://class.katelya.eu.org/api/fosu/session/bootstrap?ts=123"), true);
  assert.strictEqual(securitySessionService.isBootstrapUrl("https://evil.example/api/fosu/session/bootstrap"), false);

  await request.get("/api/fosu/prefetch", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("/api/fosu/prefetch") >= 0).header["X-Fosu-Session"], "session-token-1");

  await request.get("https://class.katelya.eu.org/api/fosu/periodic-data", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("/api/fosu/periodic-data") >= 0).header["X-Fosu-Session"], "session-token-1");

  await request.get("https://class.katelya.eu.org/api/fosu/app-config?ts=123", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("/api/fosu/app-config?ts=123") >= 0).header["X-Fosu-Session"], "session-token-1");

  await request.get("https://class.katelya.eu.org/api/fosu/bootstrap?ts=123#hash", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("/api/fosu/bootstrap?ts=123") >= 0).header["X-Fosu-Session"], "session-token-1");

  await request.post("/api/fosu/session/bootstrap", { code: "manual-code" }, { showLoading: false, silentError: true });
  const manualBootstrap = latestCall(state.calls, (call) => call.data && call.data.code === "manual-code");
  assert(manualBootstrap, "manual bootstrap request should be captured");
  assert.strictEqual(manualBootstrap.header["X-Fosu-Session"], undefined, "session bootstrap must not include old session header");

  await request.get("https://evil.example/api/fosu/prefetch", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("https://evil.example/api/fosu/prefetch") === 0).header["X-Fosu-Session"], undefined);

  await request.get("https://class.katelya.eu.org.evil.example/api/fosu/prefetch", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("https://class.katelya.eu.org.evil.example") === 0).header["X-Fosu-Session"], undefined);

  await request.get("https://class.katelya.eu.org/static/health", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("/static/health") >= 0).header["X-Fosu-Session"], undefined);

  await request.get("//evil.example/api/fosu/prefetch", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("//evil.example/api/fosu/prefetch") >= 0).header["X-Fosu-Session"], undefined);

  securitySessionService.clearSession();
  mockEnv.storage.set(securitySessionService.STORAGE_KEY, {
    sessionToken: "expired-token",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    securityMode: "ticket",
    staticAccessMode: "ticket",
  });
  const loginBeforeExpired = state.loginCalls;
  const bootstrapBeforeExpired = state.sessionBootstrapCalls;
  await request.get("/api/fosu/catalog", {}, { showLoading: false, silentError: true });
  assert.strictEqual(state.loginCalls, loginBeforeExpired + 1, "expired session should trigger wx.login");
  assert.strictEqual(state.sessionBootstrapCalls, bootstrapBeforeExpired + 1, "expired session should bootstrap once");
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("/api/fosu/catalog") >= 0).header["X-Fosu-Session"], `session-token-${state.sessionBootstrapCalls}`);

  securitySessionService.clearSession();
  const loginBeforeConcurrent = state.loginCalls;
  const bootstrapBeforeConcurrent = state.sessionBootstrapCalls;
  await Promise.all([
    request.get("/api/fosu/prefetch", {}, { showLoading: false, silentError: true }),
    request.get("/api/fosu/periodic-data", {}, { showLoading: false, silentError: true }),
    request.get("/api/fosu/bootstrap", {}, { showLoading: false, silentError: true }),
  ]);
  assert.strictEqual(state.loginCalls - loginBeforeConcurrent, 1, "concurrent requests should share one wx.login");
  assert.strictEqual(state.sessionBootstrapCalls - bootstrapBeforeConcurrent, 1, "concurrent requests should share one bootstrap");
  const sessionBootstrap = latestCall(state.calls, (call) => call.url.indexOf("/api/fosu/session/bootstrap") >= 0);
  assert(sessionBootstrap.timeout >= 15000, "session bootstrap should tolerate slow production cold starts");

  assert.strictEqual(staticAccessService.isStaticReleaseUrl("/static/releases/url-compat-release/manifest.json"), true);
  assert.strictEqual(staticAccessService.isStaticReleaseUrl("https://class.katelya.eu.org/static/releases/url-compat-release/manifest.json?ts=1"), true);
  assert.strictEqual(staticAccessService.isStaticReleaseUrl("https://evil.example/static/releases/url-compat-release/manifest.json"), false);
  assert.strictEqual(staticAccessService.isStaticReleaseUrl("https://class.katelya.eu.org.evil.example/static/releases/url-compat-release/manifest.json"), false);

  await request.get("/static/releases/url-compat-release/manifest.json", {}, { showLoading: false, silentError: true });
  assert.strictEqual(latestCall(state.calls, (call) => call.url.indexOf("/static/releases/url-compat-release/manifest.json") >= 0).header["X-Fosu-Static-Ticket"], "static-ticket-url-compat-release");
  const staticTicketBootstrap = latestCall(state.calls, (call) => call.url.indexOf("/api/fosu/static-access/bootstrap") >= 0);
  assert(staticTicketBootstrap, "static ticket bootstrap should be captured");
  assert.strictEqual(staticTicketBootstrap.header["X-Fosu-Session"], `session-token-${state.sessionBootstrapCalls}`, "static ticket bootstrap must include session header");

  await request.get("https://evil.example/static/releases/url-compat-release/manifest.json", {}, { showLoading: false, silentError: true });
  const evilStatic = latestCall(state.calls, (call) => call.url.indexOf("https://evil.example/static/releases/url-compat-release") === 0);
  assert.strictEqual(evilStatic.header["X-Fosu-Static-Ticket"], undefined);

  await request.get("/api/fosu/app-config?token=query-secret&ts=456", {}, { showLoading: false, silentError: true });
  const diagnostics = JSON.stringify(request.getRequestDiagnostics());
  assert(diagnostics.indexOf("\"trustedApiUrl\":true") >= 0, "diagnostics should include trustedApiUrl");
  assert(diagnostics.indexOf("\"sessionAvailable\":true") >= 0, "diagnostics should include sessionAvailable");
  assert(diagnostics.indexOf("\"sessionHeaderAttached\":true") >= 0, "diagnostics should include sessionHeaderAttached");
  assert(diagnostics.indexOf("session-token-") < 0, "diagnostics must not leak session token");
  assert(diagnostics.indexOf("static-ticket-") < 0, "diagnostics must not leak static ticket");
  assert(diagnostics.indexOf("query-secret") < 0, "diagnostics must redact sensitive query values");

  await wait(30);
  const clientCheckCall = latestCall(state.calls, (call) => call.url.indexOf("/api/fosu/security/client-check") >= 0);
  assert(clientCheckCall, "client-check should be reported after a protected session request");
  assert.strictEqual(clientCheckCall.method, "POST");
  assert(clientCheckCall.timeout >= 12000, "client-check should not use an aggressive 5s timeout");
  assert(/^session-token-\d+$/.test(clientCheckCall.header["X-Fosu-Session"] || ""), "client-check must include a session header");
  assert.strictEqual(clientCheckCall.data.sessionHeaderAttached, true);
  assert.strictEqual(JSON.stringify(clientCheckCall.data).indexOf("session-token-"), -1, "client-check payload must not include session token");

  state.failSessionOnceFor = "/api/fosu/search-index";
  const beforeRefreshBootstrap = state.sessionBootstrapCalls;
  await request.get("/api/fosu/search-index", { type: "class" }, { showLoading: false, silentError: true, retries: 0 });
  assert.strictEqual(state.sessionBootstrapCalls, beforeRefreshBootstrap + 1, "401/403 session error should force one refresh");
  const searchCalls = state.calls.filter((call) => call.url.indexOf("/api/fosu/search-index") >= 0);
  assert(searchCalls.length >= 2, "original request should be retried after session refresh");
  assert.strictEqual(searchCalls[searchCalls.length - 1].header["X-Fosu-Session"], `session-token-${state.sessionBootstrapCalls}`, "retry should use refreshed session header");
}

async function runStartupTests() {
  clearModule("../miniprogram/app");
  const securitySessionService = require("../miniprogram/services/securitySessionService");
  const staticAccessService = require("../miniprogram/services/staticAccessService");
  const releasePackService = require("../miniprogram/services/releasePackService");
  const platformDataService = require("../miniprogram/services/platformDataService");
  const appConfigService = require("../miniprogram/services/appConfigService");
  const { BOOTSTRAP_CACHE_KEY } = require("../miniprogram/utils/storage");

  mockEnv.clearStorage();
  securitySessionService.clearSession();
  staticAccessService.clearTicket();

  const term = "2025-2026-2";
  const releaseVersion = "startup-url-compat";
  mockEnv.storage.set(releasePackService.LOCAL_ACTIVE_RELEASE_KEY, {
    savedAt: Date.now(),
    term,
    releaseVersion,
    manifest: {
      success: true,
      term,
      semester: term,
      releaseVersion,
      version: releaseVersion,
      cacheEpoch: 1,
      forceRefreshToken: "startup-force-token",
      updatedAt: "2026-06-04T00:00:00.000Z",
    },
  });
  mockEnv.storage.set(BOOTSTRAP_CACHE_KEY, { success: true, releaseVersion, term });
  mockEnv.storage.set(platformDataService.PLATFORM_PREFETCH_CACHE_KEY, { success: true, releaseVersion, term });
  mockEnv.storage.set(platformDataService.PLATFORM_PERIODIC_CACHE_KEY, { success: true, releaseVersion, term });
  mockEnv.storage.set(appConfigService.APP_CONFIG_CACHE_KEY, {
    config: { success: true, currentSemester: term, releaseVersion },
    updatedAt: new Date().toISOString(),
  });

  const scheduled = [];
  let loginSuccess = null;
  let startupLoginCalls = 0;
  const startupCalls = [];
  global.setTimeout = (fn, delay) => {
    scheduled.push({ fn, delay });
    return scheduled.length;
  };
  global.wx.login = (options) => {
    startupLoginCalls += 1;
    loginSuccess = options.success;
  };
  global.wx.mockRequest = (options) => {
    startupCalls.push({
      url: options.url,
      header: Object.assign({}, options.header || {}),
      data: options.data || {},
    });
    if (String(options.url).indexOf("/api/fosu/session/bootstrap") >= 0) {
      realSetTimeout(() => options.success({
        statusCode: 200,
        data: {
          success: true,
          sessionToken: "startup-session-token",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          expiresIn: 3600,
          securityMode: "ticket",
          staticAccessMode: "ticket",
        },
      }), 0);
      return;
    }
    if (String(options.url).indexOf("/api/fosu/static-access/bootstrap") >= 0) {
      realSetTimeout(() => options.success({
        statusCode: 200,
        data: {
          success: true,
          ticket: "startup-static-ticket",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          headerName: "X-Fosu-Static-Ticket",
        },
      }), 0);
      return;
    }
    realSetTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        term,
        releaseVersion,
        version: releaseVersion,
        items: [],
      },
    }), 0);
  };

  clearModule("../miniprogram/app");
  require("../miniprogram/app");
  const app = mockEnv.createAppInstance();
  app.onLaunch();
  assert.strictEqual(app.globalData.activeRelease.releaseVersion, releaseVersion, "local active release should be available immediately");
  assert.strictEqual(app.globalData.bootstrapData.releaseVersion, releaseVersion, "local bootstrap cache should be available immediately");

  scheduled.sort((left, right) => left.delay - right.delay).forEach((item) => item.fn());
  assert.strictEqual(startupLoginCalls, 1, "startup warmup should call wx.login once before background refreshes");
  assert.strictEqual(startupCalls.length, 0, "background dynamic refresh should wait for warmup before wx.request");
  global.setTimeout = realSetTimeout;

  loginSuccess({ code: "startup-code" });
  await wait(40);
  ["/api/fosu/prefetch", "/api/fosu/periodic-data", "/api/fosu/bootstrap", "/api/fosu/app-config"].forEach((path) => {
    const call = latestCall(startupCalls, (item) => item.url.indexOf(path) >= 0);
    assert(call, `${path} should run after warmup`);
    assert.strictEqual(call.header["X-Fosu-Session"], "startup-session-token", `${path} should include session header`);
  });

  clearModule("../miniprogram/app");
  mockEnv.clearStorage();
  securitySessionService.clearSession();
  staticAccessService.clearTicket();
  const degradedScheduled = [];
  const degradedCalls = [];
  let degradedLoginCalls = 0;
  global.setTimeout = (fn, delay) => {
    degradedScheduled.push({ fn, delay });
    return degradedScheduled.length;
  };
  global.wx.login = (options) => {
    degradedLoginCalls += 1;
    options.fail({ errMsg: "login failed" });
  };
  global.wx.mockRequest = (options) => {
    degradedCalls.push({
      url: options.url,
      header: Object.assign({}, options.header || {}),
    });
    realSetTimeout(() => options.success({
      statusCode: 200,
      data: { success: true, releaseVersion, term, items: [] },
    }), 0);
  };
  require("../miniprogram/app");
  const degradedApp = mockEnv.createAppInstance();
  degradedApp.onLaunch();
  degradedScheduled.sort((left, right) => left.delay - right.delay).forEach((item) => item.fn());
  global.setTimeout = realSetTimeout;
  await wait(40);
  const degradedPrefetch = latestCall(degradedCalls, (item) => item.url.indexOf("/api/fosu/prefetch") >= 0);
  assert(degradedPrefetch, "startup refresh should degrade after warmup failure");
  assert.strictEqual(degradedPrefetch.header["X-Fosu-Session"], undefined, "degraded startup refresh should skip session header");
  assert.strictEqual(degradedLoginCalls, 1, "startup warmup failure should not trigger repeated wx.login calls");
}

async function run() {
  try {
    await runHeaderCompatibilityTests();
    await runStartupTests();
    console.log("test-miniprogram-url-compatibility passed");
  } finally {
    global.URL = realURL;
    global.setTimeout = realSetTimeout;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
