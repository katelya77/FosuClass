const assert = require("assert");

process.env.NODE_ENV = "development";

const clientCheckService = require("../server/src/services/clientCheckService");
const securityEvents = require("../server/src/services/securityEventService");

const payload = clientCheckService.normalizeClientCheckPayload({
  clientBuildId: "security-transport-v2-0aea96c-20260607092253",
  gitCommitShortSha: "0aea96c",
  buildTimestamp: "2026-06-07T09:22:53.653Z",
  miniprogramVersion: "develop",
  releaseVersion: "release-20260607",
  securityMode: "observe",
  sessionHeaderAttached: true,
  staticTicketAttached: false,
  requestPipelineVersion: "security-transport-v2",
  timestamp: "2026-06-07T09:23:00.000Z",
  platform: "devtools",
  errorCode: "",
});

assert.strictEqual(payload.sessionHeaderAttached, true);
assert.strictEqual(payload.clientBuildId.indexOf("token"), -1);

assert.throws(() => clientCheckService.normalizeClientCheckPayload({
  clientBuildId: "ok",
  sessionToken: "secret",
}), /CLIENT_CHECK_REJECTED_FIELD/);

clientCheckService.recordClientCheckSuccess({
  path: "/security/client-check",
  method: "POST",
  clientIpInfo: { anonymizedIp: "127.0.0.0" },
  fosuSession: {
    openidHash: "openid-hash-value",
    sessionIdHash: "session-hash-value",
  },
}, payload);

const summary = securityEvents.getSecurityEventSummary();
assert.strictEqual(summary.counts["security-client-check-success"], 1);
assert(summary.clientCheck.latest, "latest client-check should be exposed");
assert.strictEqual(summary.clientCheck.latest.clientBuildId, payload.clientBuildId);
assert.strictEqual(JSON.stringify(summary).indexOf("openid-hash-value"), -1, "event summary must only expose prefixes");
assert.strictEqual(JSON.stringify(summary).indexOf("session-hash-value"), -1, "event summary must only expose prefixes");

console.log("test-security-client-check passed");
