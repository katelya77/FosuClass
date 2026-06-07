const http = require("http");
const https = require("https");

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  if (!match) return fallback;
  if (match === name) {
    const index = process.argv.indexOf(match);
    return process.argv[index + 1] || fallback;
  }
  return match.slice(prefix.length) || fallback;
}

function request(baseUrl, path, options = {}) {
  const target = new URL(path, baseUrl);
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(target, {
      method: options.method || "GET",
      headers: Object.assign({
        "Content-Type": "application/json",
      }, options.headers || {}),
      timeout: Number(options.timeout || 8000),
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 128 * 1024) req.destroy(new Error("POSTDEPLOY_RESPONSE_TOO_LARGE"));
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on("timeout", () => req.destroy(new Error("POSTDEPLOY_TIMEOUT")));
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

async function run() {
  const baseUrl = argValue("--base-url", process.env.FOSU_POSTDEPLOY_BASE_URL || "http://127.0.0.1:3000");
  const securityModeService = require("../src/services/securityModeService");
  const { getRouteSecurityPolicy, ACCESS_LEVELS } = require("../src/security/routeSecurityPolicy");

  const status = securityModeService.getSecurityStatus();
  if (!status.mode) throw new Error("SECURITY_MODE_MISSING");
  if (status.configurationValid === false && status.mode !== "observe") {
    throw new Error("SECURITY_CONFIGURATION_INVALID");
  }

  const clientCheckPolicy = getRouteSecurityPolicy({
    method: "POST",
    path: "/security/client-check",
  });
  if (clientCheckPolicy.accessLevel !== ACCESS_LEVELS.MINIPROGRAM_SESSION) {
    throw new Error("CLIENT_CHECK_ROUTE_POLICY_INVALID");
  }

  const health = await request(baseUrl, "/api/health");
  if (health.statusCode < 200 || health.statusCode >= 300) {
    throw new Error(`HEALTHCHECK_HTTP_${health.statusCode}`);
  }

  const bootstrap = await request(baseUrl, "/api/fosu/session/bootstrap", {
    method: "POST",
    body: "{}",
  });
  if (bootstrap.statusCode === 404 || bootstrap.statusCode === 0) {
    throw new Error(`SESSION_BOOTSTRAP_UNAVAILABLE_${bootstrap.statusCode}`);
  }

  console.log(JSON.stringify({
    success: true,
    checkedAt: new Date().toISOString(),
    baseUrl,
    securityMode: status.mode,
    staticAccessMode: status.staticAccessMode,
    healthStatus: health.statusCode,
    sessionBootstrapStatus: bootstrap.statusCode,
  }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || error.message || "SECURITY_POSTDEPLOY_FAILED",
  }, null, 2));
  process.exit(1);
});
