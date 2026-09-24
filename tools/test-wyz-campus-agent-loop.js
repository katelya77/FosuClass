const assert = require("assert");
const fs = require("fs");
const path = require("path");
const agent = require("../deploy/wyz-campus-agent/src/index");

const TOKEN = "unit-test-campus-agent-token-value";
const SIGNING = "unit-test-campus-agent-signing-material";
const PASSWORD = "unit-test-student-password";
const STUDENT = "20250410303";

function scripted(responses) {
  const calls = [];
  let cursor = 0;
  return {
    calls,
    async request(method, pathname) {
      calls.push({ method, pathname, at: responses.clock ? responses.clock() : 0 });
      const next = responses.queue[cursor++] || responses.queue[responses.queue.length - 1];
      if (next && next.throw) throw next.throw;
      return next;
    },
  };
}

async function runUntil(limitMs, queue, extra) {
  let clock = 0;
  const logs = [];
  const jobs = [];
  const script = scripted({ queue, clock: () => clock });
  let stopped = false;
  await agent.runAgentLoop(Object.assign({
    brokerRequest: script.request,
    pollMs: 3000,
    heartbeatMs: 30000,
    now: () => clock,
    brokerHost: "agent-broker.example",
    agentId: "wyz-campus-01",
    log: (entry) => logs.push(entry),
    shouldStop: () => stopped,
    sleep: async (ms) => {
      clock += ms;
      if (clock >= limitMs) stopped = true;
    },
    runJob: async (job) => {
      jobs.push(job);
    },
  }, extra));
  return { clock, logs, jobs, calls: script.calls };
}

async function main() {
  assert.strictEqual(agent.intervalMs(undefined, 3000), 3000);
  assert.strictEqual(agent.intervalMs("0", 3000), 3000);
  assert.strictEqual(agent.intervalMs("3000", 3000), 3000);
  assert.strictEqual(agent.retryDelay(429, "12"), 12000);
  assert.strictEqual(agent.retryDelay(429, "1"), 10000);
  assert.strictEqual(agent.retryDelay(404, ""), 10000);
  assert.strictEqual(agent.retryDelay(403, ""), 10000);
  assert.strictEqual(agent.retryDelay(500, ""), 3000);
  assert.strictEqual(agent.retryDelay(0, ""), 3000);

  const idle = await runUntil(10000, [{ statusCode: 200 }, { statusCode: 204 }]);
  const claims = idle.calls.filter((call) => call.pathname.endsWith("/jobs/claim"));
  const beats = idle.calls.filter((call) => call.pathname.endsWith("/heartbeat"));
  assert.ok(claims.length >= 3 && claims.length <= 4, `claim count ${claims.length}`);
  assert.strictEqual(beats.length, 1);
  assert.ok(claims.every((call, index) => index === 0 || call.at - claims[index - 1].at >= 3000));
  assert.ok(!idle.logs.some((entry) => /no job/i.test(JSON.stringify(entry))));

  const limited = await runUntil(20000, [
    { statusCode: 200 },
    { statusCode: 429, retryAfter: "12" },
    { statusCode: 204 },
  ]);
  const limitedClaims = limited.calls.filter((call) => call.pathname.endsWith("/jobs/claim"));
  assert.ok(limitedClaims.length >= 2);
  assert.ok(limitedClaims[1].at - limitedClaims[0].at >= 12000);

  const rejected = await runUntil(15000, [
    { statusCode: 403, retryAfter: "" },
    { statusCode: 200 },
    { statusCode: 204 },
  ]);
  const rejectedBeats = rejected.calls.filter((call) => call.pathname.endsWith("/heartbeat"));
  assert.ok(rejectedBeats[1].at - rejectedBeats[0].at >= 10000);
  assert.ok(rejected.logs.some((entry) => entry.event === "broker-auth-failed" && entry.status === 403));

  const missing = await runUntil(15000, [
    { statusCode: 200 },
    { statusCode: 404 },
    { statusCode: 204 },
  ]);
  const missingClaims = missing.calls.filter((call) => call.pathname.endsWith("/jobs/claim"));
  assert.ok(missingClaims[1].at - missingClaims[0].at >= 10000);

  const offline = await runUntil(9000, [
    { throw: new Error("ECONNRESET") },
    { statusCode: 200 },
    { statusCode: 204 },
  ]);
  assert.ok(offline.calls[1].at >= 3000);
  assert.ok(offline.logs.some((entry) => entry.event === "broker-failed" && entry.retryMs === 3000));

  const done = await runUntil(6000, [
    { statusCode: 200 },
    { statusCode: 200, body: { jobId: "abc123456789", password: PASSWORD, studentId: STUDENT } },
    { statusCode: 204 },
  ]);
  assert.strictEqual(done.jobs.length, 1);
  assert.strictEqual(done.jobs[0].jobId, "abc123456789");
  const afterJob = done.calls.filter((call) => call.pathname.endsWith("/jobs/claim"));
  assert.ok(afterJob.length >= 2);
  assert.ok(done.logs.some((entry) => entry.event === "job-claimed" && entry.jobId === "abc12345"));

  const control = agent.createRunControl();
  let claimedOnce = false;
  const stopping = agent.runAgentLoop({
    brokerRequest: async (method, pathname) => {
      if (pathname.endsWith("/heartbeat")) return { statusCode: 200 };
      claimedOnce = true;
      return { statusCode: 204 };
    },
    pollMs: 3000,
    heartbeatMs: 30000,
    brokerHost: "agent-broker.example",
    agentId: "wyz-campus-01",
    log: () => {},
    shouldStop: () => control.stopped(),
    sleep: (ms) => control.sleep(ms),
    runJob: async () => {},
  });
  const started = Date.now();
  while (!claimedOnce && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  control.stop();
  await stopping;
  assert.ok(control.stopped());

  process.env.CAMPUS_AGENT_TOKEN = TOKEN;
  process.env.CAMPUS_AGENT_SIGNING_SECRET = SIGNING;
  const printed = [];
  const original = console.log;
  console.log = (line) => printed.push(String(line));
  try {
    await agent.runAgentLoop({
      brokerRequest: async (method, pathname) => {
        if (pathname.endsWith("/heartbeat")) return { statusCode: 403 };
        return { statusCode: 204, body: { password: PASSWORD, studentId: STUDENT } };
      },
      pollMs: 3000,
      heartbeatMs: 30000,
      brokerHost: "agent-broker.example",
      agentId: "wyz-campus-01",
      shouldStop: () => false,
      sleep: async () => { throw new Error("STOP_AFTER_LOG"); },
      runJob: async () => {},
    });
  } catch (error) {
    if (!error || error.message !== "STOP_AFTER_LOG") throw error;
  } finally {
    console.log = original;
  }
  const text = printed.join("\n");
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes(SIGNING));
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!text.includes(STUDENT));
  assert.ok(!/authorization|signature|cookie/i.test(text));

  const service = fs.readFileSync(path.join(__dirname, "..", "deploy", "wyz-campus-agent", "wyz-campus-agent.service"), "utf8");
  assert.ok(service.includes("CAMPUS_AGENT_POLL_INTERVAL_MS=3000"));
  assert.ok(service.includes("CAMPUS_AGENT_HEARTBEAT_INTERVAL_MS=30000"));
  assert.ok(service.indexOf("CAMPUS_AGENT_POLL_INTERVAL_MS=3000") < service.indexOf("EnvironmentFile="));

  console.log("wyz-campus-agent-loop PASS");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
