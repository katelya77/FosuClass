const assert = require("assert");
const server = require("../server/src/security/campusAgentSignature");
const agent = require("../deploy/wyz-campus-agent/src/signature");

const input = {
  method: "POST",
  path: "/api/campus-agent/v1/jobs/claim",
  timestamp: "1710000000000",
  nonce: "parity-nonce",
  body: Buffer.from("{\"agentId\":\"wyz-campus-01\"}"),
};
const secret = ["unit-test", "campus-agent", "signing-secret", "for-parity-only"].join("-");
assert.strictEqual(server.signRequest(secret, input), agent.signRequest(secret, input));
assert.strictEqual(server.bodyHash(input.body), agent.bodyHash(input.body));
console.log("campus-agent-signature-parity PASS");
