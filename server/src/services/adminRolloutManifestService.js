const fs = require("fs");
const path = require("path");

const RUNTIME_MANIFEST_PATH = path.posix.resolve("/app", "config/admin-rollout-manifest.json");
const REPOSITORY_MANIFEST_PATH = path.resolve(__dirname, "../../../config/admin-rollout-manifest.json");
const REQUIRED_MODULE_FIELDS = ["productionWriteEnabled", "routes", "httpEvidence", "browserEvidence"];

function fail(message) {
  const error = new Error("Invalid admin rollout manifest: " + message);
  error.code = "ADMIN_ROLLOUT_MANIFEST_INVALID";
  throw error;
}

function resolveManifestPath() {
  return fs.existsSync(RUNTIME_MANIFEST_PATH) ? RUNTIME_MANIFEST_PATH : REPOSITORY_MANIFEST_PATH;
}

function normalizePath(routePath) {
  let normalized = String(routePath || "").split(/[?#]/)[0].trim();
  if (!normalized) return "/";
  if (!normalized.startsWith("/")) normalized = "/" + normalized;
  if (normalized === "/api/admin") return "/";
  if (normalized.startsWith("/api/admin/")) normalized = normalized.slice("/api/admin".length);
  return normalized.replace(/\/+$/, "") || "/";
}

function validateEvidence(value, field, moduleName) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail("modules." + moduleName + "." + field + " must be a string array");
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("root must be an object");
  if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (typeof manifest.rolloutVersion !== "string" || !manifest.rolloutVersion.trim()) fail("rolloutVersion must be a non-empty string");
  if (!manifest.admin || typeof manifest.admin !== "object") fail("admin is required");
  if (manifest.admin.primary !== "legacy") fail("admin.primary must remain legacy");
  if (manifest.admin.nextEnabled !== true) fail("admin.nextEnabled must remain true");
  if (!["core", "browser"].includes(manifest.imageTarget)) fail("imageTarget must be core or browser");
  if (!manifest.modules || typeof manifest.modules !== "object" || Array.isArray(manifest.modules)) fail("modules must be an object");

  const routes = new Map();
  const modules = {};
  for (const [moduleName, moduleConfig] of Object.entries(manifest.modules)) {
    if (!/^[a-z][a-z0-9-]*$/.test(moduleName)) fail("invalid module name " + moduleName);
    if (!moduleConfig || typeof moduleConfig !== "object" || Array.isArray(moduleConfig)) fail("modules." + moduleName + " must be an object");
    for (const field of REQUIRED_MODULE_FIELDS) {
      if (!(field in moduleConfig)) fail("modules." + moduleName + "." + field + " is required");
    }
    if (typeof moduleConfig.productionWriteEnabled !== "boolean") fail("modules." + moduleName + ".productionWriteEnabled must be boolean");
    if (!Array.isArray(moduleConfig.routes) || !moduleConfig.routes.length) fail("modules." + moduleName + ".routes must be a non-empty array");
    validateEvidence(moduleConfig.httpEvidence, "httpEvidence", moduleName);
    validateEvidence(moduleConfig.browserEvidence, "browserEvidence", moduleName);
    const normalizedRoutes = moduleConfig.routes.map((route) => {
      if (typeof route !== "string" || route !== normalizePath(route) || route === "/") fail("modules." + moduleName + ".routes contains an invalid route");
      if (routes.has(route)) fail("duplicate route " + route + " for " + moduleName + " and " + routes.get(route));
      routes.set(route, moduleName);
      return route;
    });
    modules[moduleName] = Object.freeze({
      productionWriteEnabled: moduleConfig.productionWriteEnabled,
      routes: Object.freeze(normalizedRoutes),
      httpEvidence: Object.freeze(moduleConfig.httpEvidence.slice()),
      browserEvidence: Object.freeze(moduleConfig.browserEvidence.slice()),
    });
  }

  if (!Object.keys(modules).length) fail("modules must not be empty");
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    rolloutVersion: manifest.rolloutVersion,
    admin: Object.freeze({ primary: manifest.admin.primary, nextEnabled: manifest.admin.nextEnabled }),
    imageTarget: manifest.imageTarget,
    modules: Object.freeze(modules),
  });
}

let cachedManifest;

function loadAdminRolloutManifest() {
  if (cachedManifest) return cachedManifest;
  const manifestPath = resolveManifestPath();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("unable to read " + manifestPath + ": " + error.message);
  }
  cachedManifest = validateManifest(parsed);
  return cachedManifest;
}

function resolveWriteModule(routePath) {
  const normalized = normalizePath(routePath);
  const matches = [];
  for (const [moduleName, moduleConfig] of Object.entries(loadAdminRolloutManifest().modules)) {
    if (moduleConfig.routes.some((route) => normalized === route || normalized.startsWith(route + "/"))) {
      matches.push(moduleName);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function getKnownWriteModules() {
  return Object.freeze(Object.keys(loadAdminRolloutManifest().modules));
}

function getProductionWriteModules() {
  const manifest = loadAdminRolloutManifest();
  return Object.freeze(Object.keys(manifest.modules).filter((moduleName) => manifest.modules[moduleName].productionWriteEnabled));
}

module.exports = {
  RUNTIME_MANIFEST_PATH,
  REPOSITORY_MANIFEST_PATH,
  resolveManifestPath,
  loadAdminRolloutManifest,
  resolveWriteModule,
  getKnownWriteModules,
  getProductionWriteModules,
};
