const DEFAULT_COOLDOWN_SECONDS = 600;
const MIN_COOLDOWN_SECONDS = 60;
const MAX_COOLDOWN_SECONDS = 3600;

const until = new Map();

function cooldownSeconds() {
  const parsed = Number(process.env.CAMPUS_SYNC_CHALLENGE_COOLDOWN_SECONDS);
  if (!Number.isInteger(parsed) || parsed < MIN_COOLDOWN_SECONDS || parsed > MAX_COOLDOWN_SECONDS) {
    return DEFAULT_COOLDOWN_SECONDS;
  }
  return parsed;
}

function note(ownerKey, now) {
  const key = String(ownerKey || "");
  if (!key) return;
  until.set(key, Number(now || Date.now()) + cooldownSeconds() * 1000);
}

function check(ownerKey, now) {
  const key = String(ownerKey || "");
  const current = Number(now || Date.now());
  const expires = until.get(key) || 0;
  if (!expires || expires <= current) {
    if (expires) until.delete(key);
    return { blocked: false, retryAfterSeconds: 0 };
  }
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((expires - current) / 1000)),
  };
}

function resetForTests() {
  until.clear();
}

module.exports = {
  DEFAULT_COOLDOWN_SECONDS,
  check,
  cooldownSeconds,
  note,
  resetForTests,
};
