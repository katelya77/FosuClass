const assert = require("assert");

const {
  ACCESS_LEVELS,
  getRouteSecurityPolicy,
  listRouteSecurityPolicies,
} = require("../server/src/security/routeSecurityPolicy");

const publicBootstrap = getRouteSecurityPolicy({ method: "POST", path: "/session/bootstrap" });
assert.strictEqual(publicBootstrap.accessLevel, ACCESS_LEVELS.PUBLIC);

const appConfig = getRouteSecurityPolicy({ method: "GET", path: "/app-config" });
assert.strictEqual(appConfig.accessLevel, ACCESS_LEVELS.MINIPROGRAM_SESSION);

const clientCheck = getRouteSecurityPolicy({ method: "POST", path: "/security/client-check" });
assert.strictEqual(clientCheck.accessLevel, ACCESS_LEVELS.MINIPROGRAM_SESSION, "client-check should require miniprogram session");

const headDetail = getRouteSecurityPolicy({ method: "HEAD", path: "/schedule-detail" });
assert.strictEqual(headDetail.accessLevel, ACCESS_LEVELS.MINIPROGRAM_SESSION, "HEAD must use the GET auth policy");

const unknown = getRouteSecurityPolicy({ method: "GET", path: "/new-data-route" });
assert.strictEqual(unknown.accessLevel, ACCESS_LEVELS.MINIPROGRAM_SESSION, "unknown fosu routes should fail closed to session policy");

const publicPolicies = listRouteSecurityPolicies().filter((policy) => policy.accessLevel === ACCESS_LEVELS.PUBLIC);
assert(publicPolicies.some((policy) => policy.path === "/session/bootstrap"), "session bootstrap should be explicit public whitelist");

console.log("test-route-security-policy passed");
