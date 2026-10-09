#!/usr/bin/env node
"use strict";
const dns = require("dns"), net = require("net"), { classify, wait } = require("./heartbeatRecovery");
const URL = "https://class.katelya.eu.org/api/health";
async function diagnose(options = {}) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("ORACLE_TLS_POLICY_REJECTED");
  const records = await (options.lookup || dns.promises.lookup)("class.katelya.eu.org", { all: true }).catch(error => ({ errorCategory: classify(error).errorCategory, transportCode: classify(error).transportCode || null }));
  console.log(JSON.stringify({ node: process.version, bundledUndici: process.versions.undici || "UNKNOWN", dnsOrder: dns.getDefaultResultOrder(), autoSelectFamily: net.getDefaultAutoSelectFamily(), autoSelectFamilyAttemptTimeoutMs: net.getDefaultAutoSelectFamilyAttemptTimeout(), dns: Array.isArray(records) ? { ipv4Records: records.filter(item => item.family === 4).length, ipv6Records: records.filter(item => item.family === 6).length } : records, tlsCertificateVerification: "ENABLED", extraCA: process.env.NODE_EXTRA_CA_CERTS ? "present" : "missing", proxyEnvironment: Object.fromEntries(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"].map(key => [key, process.env[key] ? "present" : "missing"])), credentialHeaders: "NONE", schoolRequests: 0 }));
  const samples = Math.max(1, Math.min(5, Number(options.samples) || 3));
  for (let index = 0; index < samples; index++) {
    const started = Date.now();
    try {
      const response = await (options.fetcher || fetch)(URL, { signal: AbortSignal.timeout(15000), redirect: "error" });
      if (response.body) await response.body.cancel();
      console.log(JSON.stringify({ sample: index + 1, elapsedMs: Date.now() - started, httpStatus: response.status, result: response.ok ? "HTTP_ACKNOWLEDGED" : "HTTP_ERROR", authentication: "NOT_TESTED" }));
    } catch (cause) {
      const problem = classify(cause);
      console.log(JSON.stringify({ sample: index + 1, elapsedMs: Date.now() - started, result: "FAILED", errorCategory: problem.errorCategory, transportCode: problem.transportCode || null, authentication: "NOT_TESTED" }));
    }
    if (index + 1 < samples) await (options.sleep || wait)(30000);
  }
}
if (require.main === module) diagnose({ samples: process.argv.find(item => item.startsWith("--samples="))?.slice(10) }).catch(() => { console.error("NETWORK_DIAGNOSIS_FAILED"); process.exitCode = 1; });
module.exports = { diagnose };
