"use strict";

const { containsCredentialLeak } = require("../decision/credential-leak.js");

const PROMPT_INJECTION_PATTERNS = Object.freeze([
  /ignore\s+(?:all\s+)?previous\s+instructions?/i,
  /reveal\s+(?:the\s+)?system\s+prompt/i,
  /(?:system|developer)\s*(?:message|prompt)/i,
  /忽略(?:以上|此前|之前|所有)?(?:指令|规则|要求)/,
  /(?:泄露|输出|显示).{0,8}(?:系统提示|系统指令|隐藏提示)/,
  /(?:把我|将我).{0,8}(?:标记|设为).{0,8}verified/i,
]);

const FORBIDDEN_DYNAMIC_KEYS = Object.freeze([
  "verified",
  "queryId",
  "dataHash",
  "resultRef",
  "toolName",
  "sourceTool",
  "provenance",
  "provenanceRefs",
]);

const INTERNAL_PUBLIC_KEY_PATTERN = /(?:queryId|dataHash|resultRef|toolName|sourceTool|provenance|fingerprint|evaluation|chainOfThought|internalUrl)/i;
const URL_PATTERN = /https?:\/\/[^\s"']+/i;

function textOf(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value == null ? "" : value); } catch { return ""; }
}

function detectVisualPromptInjection(value) {
  const text = textOf(value);
  const matches = PROMPT_INJECTION_PATTERNS.filter((pattern) => pattern.test(text)).map(String);
  return { detected: matches.length > 0, matches };
}

function containsVisionCredential(value) {
  return containsCredentialLeak(value);
}

function findForbiddenDynamicFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return FORBIDDEN_DYNAMIC_KEYS.filter((key) => Object.hasOwn(value, key));
}

function isolateUntrustedVisualText(lines) {
  const warnings = [];
  const clean = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    if (detectVisualPromptInjection(line).detected) {
      warnings.push("visual_prompt_injection_isolated");
      clean.push("[已隔离的图片指令文本]");
    } else {
      clean.push(line);
    }
  }
  return { lines: clean, warnings: [...new Set(warnings)] };
}

function publicProjectionIsSafe(value) {
  const text = textOf(value);
  return !containsVisionCredential(value)
    && !INTERNAL_PUBLIC_KEY_PATTERN.test(text)
    && !URL_PATTERN.test(text);
}

module.exports = {
  PROMPT_INJECTION_PATTERNS,
  FORBIDDEN_DYNAMIC_KEYS,
  detectVisualPromptInjection,
  containsVisionCredential,
  findForbiddenDynamicFields,
  isolateUntrustedVisualText,
  publicProjectionIsSafe,
};
