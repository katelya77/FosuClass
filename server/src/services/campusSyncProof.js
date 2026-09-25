const crypto = require("crypto");

const used = new Map();
const TTL_MS = 10 * 60 * 1000;

function digest(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

function consume(code, now) {
  const current = Number(now || Date.now());
  used.forEach((seen, key) => {
    if (current - seen > TTL_MS) used.delete(key);
  });
  const key = digest(code);
  if (used.has(key)) return false;
  used.set(key, current);
  return true;
}

function resetForTests() {
  used.clear();
}

module.exports = {
  consume,
  resetForTests,
};
