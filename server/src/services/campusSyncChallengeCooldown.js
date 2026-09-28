const DEFAULT_COOLDOWN_SECONDS = 600;
const MIN_COOLDOWN_SECONDS = 60;
const MAX_COOLDOWN_SECONDS = 3600;
const CHALLENGE_REASONS = ["prelogin-captcha", "postlogin-challenge", "risk-control"];

const until = new Map();

function publicChallengeReason(value) {
  return CHALLENGE_REASONS.indexOf(value) >= 0 ? value : "";
}

function cooldownSeconds() {
  const parsed = Number(process.env.CAMPUS_SYNC_CHALLENGE_COOLDOWN_SECONDS);
  if (!Number.isInteger(parsed) || parsed < MIN_COOLDOWN_SECONDS || parsed > MAX_COOLDOWN_SECONDS) {
    return DEFAULT_COOLDOWN_SECONDS;
  }
  return parsed;
}

function note(ownerKey, now, reason) {
  const key = String(ownerKey || "");
  if (!key) return;
  until.set(key, {
    expires: Number(now || Date.now()) + cooldownSeconds() * 1000,
    reason: publicChallengeReason(reason),
  });
}

function readEntry(ownerKey, now) {
  const key = String(ownerKey || "");
  const current = Number(now || Date.now());
  const entry = until.get(key);
  const expires = entry && Number(entry.expires) || 0;
  if (!expires || expires <= current) {
    if (entry) until.delete(key);
    return null;
  }
  return {
    expires,
    reason: publicChallengeReason(entry.reason),
    retryAfterSeconds: Math.max(1, Math.ceil((expires - current) / 1000)),
  };
}

function check(ownerKey, now) {
  const entry = readEntry(ownerKey, now);
  if (!entry) return { blocked: false, retryAfterSeconds: 0, reason: "" };
  return {
    blocked: true,
    retryAfterSeconds: entry.retryAfterSeconds,
    reason: entry.reason,
  };
}

function activeCount(now) {
  const current = Number(now || Date.now());
  let count = 0;
  until.forEach((entry, key) => {
    if (entry && Number(entry.expires) > current) count += 1;
    else until.delete(key);
  });
  return count;
}

function reasonCounts(now) {
  const current = Number(now || Date.now());
  const counts = { "prelogin-captcha": 0, "postlogin-challenge": 0, "risk-control": 0 };
  until.forEach((entry, key) => {
    if (!entry || Number(entry.expires) <= current) {
      until.delete(key);
      return;
    }
    const reason = publicChallengeReason(entry.reason);
    if (reason) counts[reason] += 1;
  });
  return counts;
}

function resetForTests() {
  until.clear();
}

module.exports = {
  DEFAULT_COOLDOWN_SECONDS,
  activeCount,
  check,
  cooldownSeconds,
  note,
  publicChallengeReason,
  reasonCounts,
  resetForTests,
};
