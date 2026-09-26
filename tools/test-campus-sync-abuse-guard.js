const assert = require("assert");
const { getClientIpInfo } = require("../server/src/utils/clientIp");
const abuse = require("../server/src/services/campusSyncAbuseGuard");

function run() {
  abuse.resetForTests();
  const forged = getClientIpInfo({
    ip: "203.0.113.10",
    headers: { "x-forwarded-for": "198.51.100.8", "cf-connecting-ip": "198.51.100.9" },
  });
  assert.strictEqual(forged.upstreamTrusted, false);
  assert.strictEqual(forged.effectiveIp, "203.0.113.10");
  process.env.CAMPUS_SYNC_ANON_IP_LIMIT = "2";
  const reqA = { ip: "203.0.113.10", headers: { "x-forwarded-for": "1.1.1.1" }, clientIpInfo: forged };
  const reqB = { ip: "203.0.113.10", headers: { "x-forwarded-for": "8.8.8.8" }, clientIpInfo: getClientIpInfo({ ip: "203.0.113.10", headers: { "x-forwarded-for": "8.8.8.8" } }) };
  assert.strictEqual(abuse.noteAnonymous(reqA).limited, false);
  assert.strictEqual(abuse.noteAnonymous(reqB).limited, false);
  assert.strictEqual(abuse.noteAnonymous(reqB).limited, true);
  process.env.CAMPUS_SYNC_ABUSE_FAILS = "3";
  process.env.CAMPUS_SYNC_ABUSE_SUSPEND_MS = "60000";
  abuse.noteSecurityFailure("principal-hash-a");
  abuse.noteSecurityFailure("principal-hash-a");
  assert.strictEqual(abuse.suspension("principal-hash-a"), null);
  abuse.noteSecurityFailure("principal-hash-a");
  assert.ok(abuse.suspension("principal-hash-a"));
  assert.strictEqual(abuse.listSuspensions()[0].principalHashPrefix, "principa");
  console.log("campus-sync-abuse-guard PASS");
}

run();
