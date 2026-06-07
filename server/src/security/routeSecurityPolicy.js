const { optionalSessionGuard } = require("../utils/apiSecurity");
const { rateLimitMiddleware } = require("../services/rateLimitService");

const ACCESS_LEVELS = {
  PUBLIC: "public",
  MINIPROGRAM_SESSION: "miniprogram-session",
  ADMIN_SESSION: "admin-session",
  ADMIN_TOKEN: "admin-token",
  INTERNAL_ONLY: "internal-only",
};

const policies = [
  { path: "/session/bootstrap", methods: ["POST"], accessLevel: ACCESS_LEVELS.PUBLIC, rateLimitProfile: "session-bootstrap", bodyLimit: 8 * 1024, cachePolicy: "no-store" },
  { path: "/client-diagnosis", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.PUBLIC, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "no-store" },
  { path: "/security/client-check", methods: ["POST"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 8 * 1024, cachePolicy: "no-store" },

  { path: "/app-config", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "no-store" },
  { path: "/bootstrap", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "no-store" },
  { path: "/prefetch", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "no-store" },
  { path: "/periodic-data", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "mixed" },
  { path: "/static-access/bootstrap", methods: ["POST"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "static-ticket", bodyLimit: 8 * 1024, cachePolicy: "no-store" },

  { path: "/search-index", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "search", bodyLimit: 0, cachePolicy: "mixed" },
  { path: "/search/classes", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "search", bodyLimit: 0, cachePolicy: "short-public" },
  { path: "/search/teachers", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "search", bodyLimit: 0, cachePolicy: "short-public" },
  { path: "/search/classrooms", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "search", bodyLimit: 0, cachePolicy: "short-public" },
  { path: "/search/courses", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "search", bodyLimit: 0, cachePolicy: "short-public" },
  { path: "/schedule-detail", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "detail", bodyLimit: 0, cachePolicy: "mixed" },
  { path: "/schedule/:type/:id", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "detail", bodyLimit: 0, cachePolicy: "short-public" },
  { path: "/release-pack/manifest", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "mixed" },
  { path: "/release-pack/index/:type", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "search", bodyLimit: 0, cachePolicy: "mixed" },
  { path: "/release-pack/detail/:type/:id", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "detail", bodyLimit: 0, cachePolicy: "mixed" },
  { path: "/release-pack/empty-room", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "mixed" },
  { path: "/class-schedule", methods: ["GET", "HEAD", "POST"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "detail", bodyLimit: 128 * 1024, cachePolicy: "no-store" },
  { path: "/teacher-schedule", methods: ["POST"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "detail", bodyLimit: 128 * 1024, cachePolicy: "no-store" },
  { path: "/classroom-schedule", methods: ["POST"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "detail", bodyLimit: 128 * 1024, cachePolicy: "no-store" },
  { path: "/course-schedule", methods: ["POST"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "detail", bodyLimit: 128 * 1024, cachePolicy: "no-store" },
  { path: "/empty-classrooms", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "mixed" },
  { path: "/catalog", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "no-store" },
  { path: "/classes", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "no-store" },
  { path: "/majors", methods: ["GET", "HEAD"], accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION, rateLimitProfile: "dynamic-read", bodyLimit: 0, cachePolicy: "no-store" },
];

function splitPath(pathname) {
  return String(pathname || "").split("?")[0].replace(/\/+$/g, "") || "/";
}

function matchPolicyPath(pattern, pathname) {
  const left = splitPath(pattern).split("/").filter(Boolean);
  const right = splitPath(pathname).split("/").filter(Boolean);
  if (left.length !== right.length) return false;
  return left.every((part, index) => part.startsWith(":") || part === right[index]);
}

function getRouteSecurityPolicy(req) {
  const method = String(req.method || "GET").toUpperCase();
  const effectiveMethod = method === "HEAD" ? "GET" : method;
  return policies.find((policy) => {
    const methods = policy.methods || ["GET"];
    return (methods.includes(method) || methods.includes(effectiveMethod)) && matchPolicyPath(policy.path, req.path || req.url || "");
  }) || {
    path: req.path || "",
    methods: [method],
    accessLevel: ACCESS_LEVELS.MINIPROGRAM_SESSION,
    rateLimitProfile: "dynamic-read",
    bodyLimit: 128 * 1024,
    cachePolicy: "no-store",
  };
}

function routeSecurityPolicyMiddleware(req, res, next) {
  if (String(req.method || "").toUpperCase() === "OPTIONS") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(204).end();
  }
  const policy = getRouteSecurityPolicy(req);
  req.routeSecurityPolicy = policy;
  const contentLength = Number(req.headers["content-length"] || 0) || 0;
  if (policy.bodyLimit && contentLength > policy.bodyLimit) {
    return res.status(413).json({
      success: false,
      code: "DYNAMIC_API_BODY_TOO_LARGE",
      reasonCode: "DYNAMIC_API_BODY_TOO_LARGE",
      message: "请求体过大。",
    });
  }
  const runLimiter = (done) => {
    const limiter = rateLimitMiddleware(policy.rateLimitProfile || "dynamic-read", {
      dimension: policy.accessLevel === ACCESS_LEVELS.MINIPROGRAM_SESSION ? "session" : "ip",
    });
    return limiter(req, res, done);
  };

  const runAccess = (done) => {
    if (policy.accessLevel === ACCESS_LEVELS.PUBLIC) {
      return done();
    }
    if (policy.accessLevel === ACCESS_LEVELS.MINIPROGRAM_SESSION) {
      return optionalSessionGuard(req, res, done);
    }
    return done();
  };

  if (policy.accessLevel === ACCESS_LEVELS.MINIPROGRAM_SESSION) {
    return runAccess(() => runLimiter(next));
  }
  return runLimiter(() => runAccess(next));
}

function listRouteSecurityPolicies() {
  return policies.slice();
}

module.exports = {
  ACCESS_LEVELS,
  getRouteSecurityPolicy,
  listRouteSecurityPolicies,
  routeSecurityPolicyMiddleware,
};
