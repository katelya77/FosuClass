"use strict";
const fs = require("fs"), path = require("path"), dns = require("dns"), https = require("https");
const HOST = "class.katelya.eu.org", ORIGIN = "https://" + HOST, ORIGIN_IPV4 = "146.235.201.244";
const CONTROL_IDLE_TIMEOUT_MS = 75000;
const DEFAULT = Object.freeze({ schema: 1, mode: "cloudflare-default" });
function reject() { throw Object.assign(new Error("COLLECTOR_TRANSPORT_REJECTED"), { code: "COLLECTOR_TRANSPORT_REJECTED" }); }
function validate(value) {
  if (!value || Array.isArray(value) || value.schema !== 1 || !["cloudflare-default", "cloudflare-ipv4", "oracle-direct"].includes(value.mode) || Object.keys(value).some(key => !["schema", "mode", "originIpv4"].includes(key))) reject();
  if (value.mode === "oracle-direct" ? value.originIpv4 !== ORIGIN_IPV4 : value.originIpv4 !== undefined) reject();
  return { ...value };
}
function load(root, platform = process.platform) {
  const file = path.join(root, "oracle-transport.json"); let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === "ENOENT") return { ...DEFAULT }; reject(); }
  const parent = fs.lstatSync(path.dirname(file));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 || parent.isSymbolicLink() || !parent.isDirectory() || platform !== "win32" && (stat.uid !== 0 || (stat.mode & 0o077) || parent.uid !== 0 || (parent.mode & 0o077))) reject();
  try { return validate(JSON.parse(fs.readFileSync(file, "utf8"))); } catch (_) { reject(); }
}
function connectionOptions(policy) {
  validate(policy);
  if (policy.mode === "cloudflare-default") reject();
  const lookup = (hostname, options, callback) => {
    if (hostname !== HOST) return callback(Object.assign(new Error("COLLECTOR_TRANSPORT_REJECTED"), { code: "COLLECTOR_TRANSPORT_REJECTED" }));
    if (policy.mode === "oracle-direct") return options && options.all ? callback(null, [{ address: ORIGIN_IPV4, family: 4 }]) : callback(null, ORIGIN_IPV4, 4);
    dns.lookup(hostname, { ...options, family: 4 }, callback);
  };
  return { family: 4, autoSelectFamily: false, servername: HOST, minVersion: "TLSv1.2", rejectUnauthorized: true, lookup, keepAlive: true, maxSockets: 1, maxFreeSockets: 1, timeout: 5000, scheduling: "lifo" };
}
function createFetcher(policy, options = {}) {
  // A 30-second heartbeat must be able to reuse its verified TLS socket.
  // This is an idle lifetime, not the connect/request/lease timeout.
  const agent = new https.Agent({ ...connectionOptions(policy), timeout: CONTROL_IDLE_TIMEOUT_MS });
  // Control-plane heartbeats must not wait behind an upload/finalize connection.
  const dataAgent = new https.Agent(connectionOptions(policy));
  const request = options.request || https.request;
  const fetcher = async (input, spec = {}) => {
    const url = new URL(input);
    if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.search || !/^\/api\/(?:health$|full-sync\/v1\/)/.test(url.pathname) || spec.redirect !== "error") reject();
    if (spec.signal && spec.signal.aborted) throw spec.signal.reason;
    return new Promise((resolve, rejectRequest) => {
      let completed = false, connectTimer, socket, phase = "connect";
      const started = Date.now();
      const finish = (cause, response) => {
        if (completed) return; completed = true; clearTimeout(connectTimer);
        if (spec.signal) spec.signal.removeEventListener("abort", abort);
        if (options.onConnection) options.onConnection({ mode: policy.mode, phase: cause ? phase : "complete", remoteFamily: socket && socket.remoteFamily, remoteAddress: socket && socket.remoteAddress, tlsAuthorized: !!(socket && socket.authorized), servername: HOST, reusedSocket: !!req.reusedSocket, elapsedMs: Date.now()-started });
        if (cause) rejectRequest(cause); else resolve(response);
      };
      const controlRequest = ["/api/health", "/api/full-sync/v1/heartbeat"].includes(url.pathname);
      const req = request(url, { method: spec.method || "GET", agent: controlRequest ? agent : dataAgent, servername: HOST, rejectUnauthorized: true, headers: { ...spec.headers, host: HOST, "accept-encoding": "identity", ...(spec.body ? { "content-length": Buffer.byteLength(spec.body) } : {}) } }, res => {
        const chunks = []; let size = 0;
        res.on("data", chunk => { size += chunk.length; if (size > 8*1024*1024) req.destroy(Object.assign(new Error("ORACLE_RESPONSE_TOO_LARGE"), { code: "ORACLE_RESPONSE_TOO_LARGE" })); else chunks.push(chunk); });
        res.once("error", cause => finish(cause));
        res.once("end", () => {
          const raw = Buffer.concat(chunks);
          finish(null, { status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: res.headers, body: { cancel: async () => {} }, json: async () => JSON.parse(raw.toString("utf8")) });
        });
      });
      const abort = () => req.destroy(spec.signal.reason);
      if (spec.signal) spec.signal.addEventListener("abort", abort, { once: true });
      req.once("error", cause => finish(cause));
      req.once("socket", value => {
        socket = value;
        if (!req.reusedSocket) {
          connectTimer = setTimeout(() => req.destroy(Object.assign(new Error("ORACLE_CONNECT_TIMEOUT"), { code: "ETIMEDOUT" })), options.connectTimeoutMs || 6000);
          value.once("connect", () => { phase = "tls"; });
          value.once("secureConnect", () => { phase = "response"; clearTimeout(connectTimer); });
        }
      });
      req.end(spec.body);
    });
  };
  fetcher.close = () => { agent.destroy(); dataAgent.destroy(); };
  return fetcher;
}
module.exports = { CONTROL_IDLE_TIMEOUT_MS, DEFAULT, HOST, ORIGIN, ORIGIN_IPV4, connectionOptions, createFetcher, load, validate };
