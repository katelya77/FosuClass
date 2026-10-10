"use strict";
const assert = require("node:assert/strict"), { test } = require("node:test");
const { parse, main } = require("./oracle-sample/queue");
test("queue command requires explicit fixed sample approval and idempotency", () => {
  const args = ["--app-dir=/opt/fosu", "--approve-sample=class", "--idempotency-key=fixture-class-001"];
  assert.equal(parse(args)["approve-sample"], "class");
  for (const bad of [args.slice(0, 1), [...args, "--request-budget=120"], [...args, "--execute"], args.map(a => a.replace("=class", "=full")), [...args, "--approve-sample=four"]]) assert.throws(() => parse(bad), /SAMPLE_QUEUE_ARGUMENT_REJECTED/);
});
test("queue uses fixed loopback API and exposes safe output only", async () => {
  const calls = [], fixtureToken = "local-fixture-credential";
  const result = await main(["--app-dir=/opt/fosu", "--approve-sample=four", "--idempotency-key=fixture-four-001", "--term=2026-2027-1"], {
    skipRootCheck: true, readCredential: () => fixtureToken,
    request: async (method, route, token, body) => {
      calls.push({ method, route, body }); assert.equal(token, fixtureToken);
      if (method === "GET") return { protocol: "collector-manual.v1", ready: true, sampleOnly: true, publishable: false };
      assert.equal(body.requestBudget, 40);
      return { success: true, queued: { skipped: false, run: { id: "sc-fixture", mode: "sample", term: body.term, samplePolicy: { kind: body.sampleKind, requestBudget: 40 }, publishable: false, coverageValid: false, approvalExpiresAt: "2026-10-10T00:30:00.000Z" } } };
    },
  });
  assert.equal(calls.length, 2); assert.equal(result.status, "PASS"); assert.equal(result.schoolRequests, 0); assert.ok(!JSON.stringify(result).includes(fixtureToken));
});
test("unready API prevents task mutation", async () => {
  let calls = 0;
  await assert.rejects(main(["--app-dir=/opt/fosu", "--approve-sample=class", "--idempotency-key=fixture-class-001"], { skipRootCheck: true, readCredential: () => "fixture", request: async () => { calls++; return { ready: false }; } }), /SAMPLE_API_NOT_READY/);
  assert.equal(calls, 1);
});
