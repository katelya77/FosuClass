"use strict";
// A separate loopback connection per maintenance request. Large synchronous
// file checks cannot leave an expired pooled socket for an authentication POST.
const http = require("node:http");
function fetchLoopback(url, options = {}) {
  const target = new URL(url);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.username || target.password) throw Object.assign(new Error("HOST_LOOPBACK_ONLY"), { code: "HOST_LOOPBACK_ONLY" });
  return new Promise((resolve, reject) => {
    const request = http.request(target, { method: options.method || "GET", agent: false, signal: options.signal, headers: { ...options.headers, connection: "close" } }, response => {
      let size = 0; const chunks = [];
      response.on("data", chunk => { size += chunk.length; if (size > 16 * 1024 * 1024) response.destroy(Object.assign(new Error("HOST_RESPONSE_TOO_LARGE"), { code: "HOST_RESPONSE_TOO_LARGE" })); else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => {
        const headers = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
      });
    });
    request.on("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}
module.exports = { fetchLoopback };
