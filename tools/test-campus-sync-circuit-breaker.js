const assert = require("assert");
const circuit = require("../server/src/services/campusSyncCircuitBreaker");

function run() {
  circuit.resetForTests();
  process.env.CAMPUS_SYNC_CIRCUIT_FAILURES = "3";
  process.env.CAMPUS_SYNC_CIRCUIT_OPEN_MS = "30000";
  for (let index = 0; index < 5; index += 1) circuit.observe("INVALID_CREDENTIALS", Date.now());
  assert.strictEqual(circuit.snapshot().state, "CLOSED");
  const start = Date.now();
  circuit.observe("TIMEOUT", start);
  circuit.observe("AGENT_OFFLINE", start + 1);
  assert.strictEqual(circuit.snapshot(start + 2).state, "CLOSED");
  circuit.observe("STRUCTURE_CHANGED", start + 2);
  assert.strictEqual(circuit.snapshot(start + 3).state, "OPEN");
  assert.strictEqual(circuit.allow(start + 4).ok, false);
  const later = start + 31000;
  const probe = circuit.allow(later);
  assert.strictEqual(probe.ok, true);
  assert.strictEqual(circuit.allow(later).ok, false);
  circuit.observe("OK", later + 1);
  assert.strictEqual(circuit.snapshot(later + 2).state, "CLOSED");
  console.log("campus-sync-circuit-breaker PASS");
}

run();
