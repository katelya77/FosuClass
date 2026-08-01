const http = require("http");
const https = require("https");

function createKeepAliveRegistry(options = {}) {
  const maxSockets = Math.max(1, Math.min(256, Number(options.maxSockets || 32) || 32));
  const maxFreeSockets = Math.max(1, Math.min(maxSockets, Number(options.maxFreeSockets || 8) || 8));
  const agents = new Map();

  function getAgent(url) {
    const parsed = new URL(String(url));
    const key = `${parsed.protocol}//${parsed.host}`;
    if (!agents.has(key)) {
      const Agent = parsed.protocol === "https:" ? https.Agent : http.Agent;
      agents.set(key, new Agent({ keepAlive: true, maxSockets, maxFreeSockets }));
    }
    return agents.get(key);
  }

  function diagnostics() {
    return Object.freeze({ originCount: agents.size, keepAlive: true, maxSockets, maxFreeSockets });
  }

  function close() {
    agents.forEach((agent) => agent.destroy());
    agents.clear();
  }

  return Object.freeze({ close, diagnostics, getAgent });
}

module.exports = {
  createKeepAliveRegistry,
};
