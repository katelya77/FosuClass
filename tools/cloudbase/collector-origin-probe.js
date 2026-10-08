"use strict";
const crypto = require("crypto");
const { performance } = require("perf_hooks");
async function read(url) {
  const start = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error("HTTP_" + response.status), { code: "HTTP_" + response.status, location: new URL(url).pathname.replace(/(\/detail\/[^/]+\/)[^/]+$/, "$1sample.json") });
  const raw = await response.text();
  return { data: JSON.parse(raw), metric: { durationMs: Math.round(performance.now() - start), rawBytes: Buffer.byteLength(raw), transferBytes: Number(response.headers.get("content-length")) || "UNKNOWN", encoding: response.headers.get("content-encoding") || "identity", cacheControl: response.headers.get("cache-control") || "", contentType: response.headers.get("content-type") || "", sha256: crypto.createHash("sha256").update(raw).digest("hex") } };
}
async function probe(base) {
  const pointerUrl = base + (base.includes("class.katelya.eu.org") ? "/static/runtime/active.json" : "/runtime/active.json");
  const pointer = await read(pointerUrl);
  const version = pointer.data.releaseVersion, root = base + (base.includes("class.katelya.eu.org") ? "/static/releases/" : "/releases/") + version;
  const metrics = { runtime: pointer.metric };
  const manifest = await read(root + "/manifest.json"); metrics.manifest = manifest.metric;
  for (const kind of ["class", "teacher", "classroom", "course"]) {
    const index = await read(root + "/index/" + kind + "/all.json"); metrics[kind + "Index"] = index.metric;
    const relative = Object.keys(manifest.data.files || {}).find((file) => file.startsWith("detail/" + kind + "/") && file.endsWith(".json"));
    const detail = await read(root + "/" + relative); metrics[kind + "DetailSample"] = detail.metric;
    const warm = await read(root + "/index/" + kind + "/all.json"); metrics[kind + "IndexSecondHttpRequest"] = warm.metric;
  }
  const after = await read(pointerUrl);
  return { base, version, term: pointer.data.term || pointer.data.activeTerm, pointerStableDuringRead: pointer.metric.sha256 === after.metric.sha256, metrics, scope: "desktop sequential public GET; second HTTP request is not wx local-cache or phone latency" };
}
async function main() {
  const cloudbase = await probe("https://cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com");
  const oracle = await probe("https://class.katelya.eu.org");
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), cloudbase, oracle, sameActiveVersion: cloudbase.version === oracle.version, phoneAcceptance: "REQUIRED", monthlyTransfer: "UNKNOWN until real query frequency and cache-hit ratio are measured" }, null, 2));
}
if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ code: error.code || error.message, location: error.location })); process.exitCode = 1; });
module.exports = { probe };
