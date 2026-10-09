#!/usr/bin/env node
"use strict";
const transport = require("./oracleTransport"), recovery = require("./heartbeatRecovery"), collector = require("./collector");
async function probe(options = {}) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw recovery.error("ORACLE_TLS_POLICY_REJECTED");
  const mode = options.mode || "oracle-direct", samples = options.samples === undefined ? 3 : options.samples;
  const policy = transport.validate({ schema: 1, mode, ...(mode === "oracle-direct" ? { originIpv4: transport.ORIGIN_IPV4 } : {}) });
  if (!Number.isInteger(samples) || samples < 1 || samples > 3 || options.reuse && options.signed) throw recovery.error("TRANSPORT_PROBE_ARGUMENT_REJECTED");
  const log = options.log || (value => console.log(JSON.stringify(value)));
  const fetcher = options.fetcher || (mode === "cloudflare-default" ? fetch : transport.createFetcher(policy, { onConnection: value => log({ connection: value }) }));
  const request = options.signed ? collector.client(collector.config(require("./credentials").readEnvFile("/etc/fosuclass/full-sync.env")), fetcher) : null;
  log({ mode, client: mode === "cloudflare-default" ? "node-fetch-undici" : "node-https", node: process.version, signed: !!options.signed, configurationChanged: false, schoolRequests: 0 });
  let failures = 0;
  try {
    for (let sample = 1; sample <= samples; sample++) {
      const start = Date.now();
      try {
        let value;
        if (request) value = await request("POST", recovery.HEARTBEAT, { ok: true });
        else { const response = await fetcher(transport.ORIGIN+"/api/health", { redirect: "error", signal: AbortSignal.timeout(15000), headers: { "user-agent": "FosuCollectorDiag/wyz-node" } }); if (!response.ok) throw recovery.httpError(response.status); value = await response.json(); }
        if (request && (!value || value.ok !== true)) throw recovery.error("ORACLE_HEARTBEAT_REJECTED", { errorCategory: "protocol", retryable: false });
        log({ sample, utc: new Date().toISOString(), elapsedMs: Date.now()-start, result: "PASS", authentication: request ? "PASS" : "NOT_TESTED", heartbeat: request ? "PASS" : "NOT_TESTED" });
      } catch (cause) {
        failures++;
        const error = cause.code && cause.code.startsWith("ORACLE_") ? cause : recovery.classify(cause);
        log({ sample, utc: new Date().toISOString(), elapsedMs: Date.now()-start, result: "FAILED", code: error.code, errorCategory: error.errorCategory || "protocol", transportCode: error.transportCode || null, authentication: "NOT_CONFIRMED" });
      }
      if (sample < samples) await (options.sleep || recovery.wait)(options.reuse ? 1000 : 30000);
    }
  } finally { if (fetcher.close) fetcher.close(); }
  return { failures, samples, mode };
}
if (require.main === module) {
  const value = name => process.argv.find(arg => arg.startsWith(name+"="))?.slice(name.length+1);
  probe({ mode: value("--mode"), samples: value("--samples") ? Number(value("--samples")) : 3, signed: process.argv.includes("--signed"), reuse: process.argv.includes("--reuse") }).then(result => { process.exitCode = result.failures ? 1 : 0; }).catch(() => { console.error("TRANSPORT_PROBE_FAILED"); process.exitCode = 1; });
}
module.exports = { probe };
