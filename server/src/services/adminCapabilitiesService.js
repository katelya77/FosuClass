/**
 * Admin UI capability flags — single source for primary/fallback and write modules.
 *
 * Env:
 *   FOSU_ADMIN_PRIMARY=legacy|next
 *   FOSU_ADMIN_NEXT_ENABLED=true|false
 *   FOSU_ADMIN_LEGACY_ENABLED=true|false
 *   FOSU_ADMIN_NEXT_WRITE_MODULES=content,feedback,audit,backups
 *     - unset or "" → no Vue write modules (explicit grant required)
 *     - "*" → all known modules; FORBIDDEN when NODE_ENV=production
 */

const KNOWN_WRITE_MODULES = Object.freeze([
  "content",
  "feedback",
  "audit",
  "backups",
  "catalog",
  "quality",
  "campus-map",
  "assistant",
  "provider",
  "security",
  "settings",
  "relay",
  "staging",
  "sync",
  "release",
  "term",
  "jobs",
  "runtime",
]);

/** Explicit production grant for Phase B (set by deploy workflow, not implicit default). */
const PHASE_B_PRODUCTION_WRITE_MODULES = Object.freeze([
  "content",
  "feedback",
  "audit",
  "backups",
]);

const PATH_MODULE_RULES = [
  { module: "content", test: (p) => /^\/(notices|news)(\/|$)/.test(p) },
  { module: "feedback", test: (p) => /^\/feedbacks?(\/|$)/.test(p) },
  { module: "audit", test: (p) => /^\/audit(-logs)?(\/|$)/.test(p) },
  { module: "backups", test: (p) => /^\/(backups|snapshots)(\/|$)/.test(p) },
  { module: "catalog", test: (p) => /^\/catalog(\/|$)/.test(p) },
  { module: "quality", test: (p) => /^\/quality(\/|$)/.test(p) },
  { module: "campus-map", test: (p) => /^\/campus-map(\/|$)/.test(p) },
  { module: "assistant", test: (p) => /^\/assistant-kb(\/|$)/.test(p) },
  { module: "provider", test: (p) => /^\/(ai-provider|ai-agent)(\/|$)/.test(p) },
  { module: "security", test: (p) => /^\/security(\/|$)/.test(p) },
  { module: "settings", test: (p) => /^\/(config|storage|export)(\/|$)/.test(p) },
  { module: "relay", test: (p) => /^\/relay(\/|$)/.test(p) },
  { module: "staging", test: (p) => /^\/staging(\/|$)/.test(p) },
  { module: "sync", test: (p) => /^\/sync(\/|$)/.test(p) },
  { module: "release", test: (p) => /^\/(release|release-pack|static-release|static-ticket|publisher)(\/|$)/.test(p) },
  { module: "term", test: (p) => /^\/terms(\/|$)/.test(p) },
  { module: "jobs", test: (p) => /^\/jobs(\/|$)/.test(p) },
];

function isProductionEnv() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function parseWriteModules(raw, options = {}) {
  const allowStar = options.allowStar !== false;
  if (raw === undefined || raw === null) {
    return [];
  }
  const text = String(raw).trim();
  if (text === "") return [];
  if (text === "*") {
    if (!allowStar || isProductionEnv()) {
      const err = new Error(
        "FOSU_ADMIN_NEXT_WRITE_MODULES=* is forbidden in production (and when allowStar=false)"
      );
      err.code = "WRITE_MODULES_STAR_FORBIDDEN";
      err.statusCode = 500;
      throw err;
    }
    return KNOWN_WRITE_MODULES.slice();
  }
  return text
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part && KNOWN_WRITE_MODULES.includes(part));
}

/**
 * Fail-fast for production misconfiguration.
 * Call from app bootstrap / config preflight.
 */
function assertWriteModulesConfigSafe() {
  const raw = process.env.FOSU_ADMIN_NEXT_WRITE_MODULES;
  if (String(raw || "").trim() === "*" && isProductionEnv()) {
    const err = new Error(
      "FOSU_ADMIN_NEXT_WRITE_MODULES=* is not allowed when NODE_ENV=production"
    );
    err.code = "WRITE_MODULES_STAR_FORBIDDEN";
    throw err;
  }
  // Ensure parse does not throw for normal lists
  parseWriteModules(raw, { allowStar: !isProductionEnv() });
  return true;
}

function getAdminPrimary() {
  const nextEnabled = process.env.FOSU_ADMIN_NEXT_ENABLED !== "false";
  const requested = String(process.env.FOSU_ADMIN_PRIMARY || "legacy").toLowerCase() === "next";
  const primary = nextEnabled && requested ? "next" : "legacy";
  return {
    nextEnabled,
    requestedPrimary: requested ? "next" : "legacy",
    primary,
    legacyEnabled: process.env.FOSU_ADMIN_LEGACY_ENABLED !== "false",
  };
}

function getWriteModuleList() {
  return parseWriteModules(process.env.FOSU_ADMIN_NEXT_WRITE_MODULES, {
    allowStar: !isProductionEnv(),
  });
}

function getWriteModulesMap() {
  const enabled = new Set(getWriteModuleList());
  const map = {};
  KNOWN_WRITE_MODULES.forEach((name) => {
    map[name] = enabled.has(name);
  });
  return map;
}

function isWriteModuleEnabled(moduleName) {
  return getWriteModuleList().includes(String(moduleName || "").toLowerCase());
}

function resolveModuleForPath(routePath) {
  const p = String(routePath || "");
  const normalized = p.startsWith("/") ? p : `/${p}`;
  for (const rule of PATH_MODULE_RULES) {
    if (rule.test(normalized)) return rule.module;
  }
  return null;
}

function getCapabilities() {
  const flags = getAdminPrimary();
  const writeModules = getWriteModulesMap();
  const list = getWriteModuleList();
  return {
    success: true,
    primary: flags.primary,
    requestedPrimary: flags.requestedPrimary,
    legacyEnabled: flags.legacyEnabled,
    nextEnabled: flags.nextEnabled,
    writeModules,
    writeModuleList: list,
    knownWriteModules: KNOWN_WRITE_MODULES.slice(),
    writeModulesSource:
      process.env.FOSU_ADMIN_NEXT_WRITE_MODULES === undefined
        ? "unset"
        : String(process.env.FOSU_ADMIN_NEXT_WRITE_MODULES).trim() === ""
          ? "empty"
          : "explicit",
    paths: {
      next: flags.primary === "next" ? "/admin/" : "/admin-next/",
      legacy: flags.primary === "next" ? "/admin-legacy/" : "/admin/",
    },
  };
}

/**
 * Gate Vue (admin-next) mutating requests by write module flags.
 * Legacy UI / tools omit X-Fosu-Admin-Client and are not blocked here.
 */
function assertNextWriteAllowed(req) {
  const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
  if (client !== "next") {
    return { ok: true, skipped: true };
  }
  const method = String(req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return { ok: true, skipped: true };
  }
  const routePath =
    (req.route && req.route.path) ||
    String(req.originalUrl || req.url || "")
      .split("?")[0]
      .replace(/^\/api\/admin/, "") ||
    "/";
  if (routePath === "/login" || routePath === "/logout") {
    return { ok: true, skipped: true };
  }
  const moduleName = resolveModuleForPath(routePath);
  if (!moduleName) {
    return {
      ok: false,
      status: 403,
      code: "MODULE_WRITE_DISABLED",
      message: `Vue write blocked: route ${routePath} is not enabled for admin-next yet`,
    };
  }
  if (!isWriteModuleEnabled(moduleName)) {
    return {
      ok: false,
      status: 403,
      code: "MODULE_WRITE_DISABLED",
      message: `Vue write blocked: module "${moduleName}" is not in FOSU_ADMIN_NEXT_WRITE_MODULES`,
      module: moduleName,
    };
  }
  return { ok: true, module: moduleName };
}

function createWriteModuleGateMiddleware() {
  return function adminWriteModuleGate(req, res, next) {
    try {
      const result = assertNextWriteAllowed(req);
      if (result.ok) return next();
      return res.status(result.status || 403).json({
        success: false,
        code: result.code || "MODULE_WRITE_DISABLED",
        message: result.message || "write module disabled",
        module: result.module || null,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        code: error.code || "WRITE_MODULES_CONFIG_ERROR",
        message: error.message,
      });
    }
  };
}

module.exports = {
  KNOWN_WRITE_MODULES,
  PHASE_B_PRODUCTION_WRITE_MODULES,
  /** @deprecated use PHASE_B_PRODUCTION_WRITE_MODULES; no longer applied as default */
  PHASE_B_DEFAULT_WRITE_MODULES: Object.freeze([]),
  parseWriteModules,
  assertWriteModulesConfigSafe,
  getAdminPrimary,
  getWriteModuleList,
  getWriteModulesMap,
  isWriteModuleEnabled,
  resolveModuleForPath,
  getCapabilities,
  assertNextWriteAllowed,
  createWriteModuleGateMiddleware,
};
