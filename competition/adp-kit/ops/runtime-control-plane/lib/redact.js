"use strict";

const SECRET_KEY = /authorization|secret(?:id|key)?|api[-_]?key|access[-_]?token|bearer|password|cookie|credential/i;
const SECRET_VALUE = /Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+\/-]{8,}|["']?(?:secret(?:id|key)?|token|password|api[_-]?key|authorization)["']?\s*[:=]\s*["']?(?!\[REDACTED\])[^\s&"'}]+/i;

function cleanString(value) {
  let output = value.replace(/([?&](?:token|access_token|api_key|secret|signature)=)[^&#\s]+/gi, "$1[REDACTED]");
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, "Bearer [REDACTED]");
  return output;
}

function redactDeep(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactDeep(child, childKey)]));
  }
  if (typeof value === "string") return cleanString(value);
  return value;
}

function containsCredential(text) {
  return SECRET_VALUE.test(String(text)) || /[?&](?:token|access_token|api_key|secret|signature)=(?!\[REDACTED\])[^&#\s]+/i.test(String(text));
}

module.exports = { containsCredential, redactDeep };
