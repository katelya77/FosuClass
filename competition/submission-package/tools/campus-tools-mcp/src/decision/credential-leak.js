"use strict";
// Decision public-projection credential boundary. Keep one matcher shared by
// receipt construction/validation and the deterministic dual-track oracle.

const CREDENTIAL_LEAK_PATTERNS = Object.freeze([
  /(?:^|[\s"'`{,;])(?:cookie|set-cookie)["']?\s*[:=]\s*["']?[^\s,;}"']+/i,
  /(?:^|[\s"'`{,;])authorization["']?\s*[:=]\s*["']?(?:basic|bearer)\s+[a-z0-9._~+/=-]+/i,
  /\b(?:basic|bearer)\s+[a-z0-9._~+/=-]{6,}/i,
  /(?:^|[\s"'`{,;])(?:password|passwd|pwd|session(?:[_ -]?id)?|x-fosu-session)["']?\s*[:=]\s*["']?[^\s,;}"']+/i,
  /(?:^|[\s"'`{,;])(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|auth[_ -]?token|token|client[_ -]?secret|secret)["']?\s*[:=]\s*["']?[^\s,;}"']+/i,
  /(?:密码|口令|会话票据)["']?\s*[:=：]\s*["']?[^\s,;}"']+/i,
  /\bsk-[a-z0-9._-]{6,}\b/i,
]);

function credentialText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value == null ? "" : value);
  } catch {
    return "";
  }
}

function containsCredentialLeak(value) {
  const text = credentialText(value);
  return CREDENTIAL_LEAK_PATTERNS.some((pattern) => pattern.test(text));
}

module.exports = {
  CREDENTIAL_LEAK_PATTERNS,
  containsCredentialLeak,
};
