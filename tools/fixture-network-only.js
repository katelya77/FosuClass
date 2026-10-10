"use strict";
// Preloaded only by fixture tests. Production collector never imports this file.
function allowed(host) { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(host)); }
function reject() { throw Object.assign(new Error("FIXTURE_EXTERNAL_NETWORK_BLOCKED"), { code: "FIXTURE_EXTERNAL_NETWORK_BLOCKED" }); }
const originalFetch = global.fetch;
global.fetch = (input, options) => { if (!allowed(new URL(typeof input === "string" || input instanceof URL ? input : input.url).hostname)) reject(); return originalFetch(input, options); };
for (const name of ["http", "https"]) {
  const module = require(name);
  for (const key of ["request", "get"]) {
    const original = module[key];
    module[key] = function (...args) { const spec = args[0]; const host = typeof spec === "string" || spec instanceof URL ? new URL(spec).hostname : spec.hostname || spec.host || "localhost"; if (!allowed(host)) reject(); return original.apply(this, args); };
  }
}
