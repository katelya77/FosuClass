#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const inputPath = process.argv[2];
const outputPath = path.resolve(process.cwd(), "sanitized.har");

const SENSITIVE_KEY = /^(cookie|set-cookie|authorization|jsessionid|token|password|pwd|passwd|fosu_password)$/i;
const SENSITIVE_PART = /(jsessionid|token|password|pwd|passwd|fosu_password)/i;
const REDACTED = "[REDACTED]";

function isSensitiveName(name) {
  return SENSITIVE_KEY.test(String(name || "")) || SENSITIVE_PART.test(String(name || ""));
}

function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.forEach((value, key) => {
      void value;
      if (isSensitiveName(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    });
    return parsed.toString();
  } catch (error) {
    return rawUrl.replace(/([?&][^=]*(?:jsessionid|token|password|pwd|passwd|fosu_password)[^=]*=)[^&]*/gi, `$1${REDACTED}`);
  }
}

function sanitizeNameValueList(list, mode) {
  if (!Array.isArray(list)) {
    return list;
  }
  return list
    .map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }
      const name = item.name || "";
      if (isSensitiveName(name)) {
        if (mode === "remove") {
          return null;
        }
        return Object.assign({}, item, {
          value: REDACTED,
        });
      }
      return sanitizeAny(item);
    })
    .filter(Boolean);
}

function sanitizePostText(text, mimeType) {
  if (typeof text !== "string") {
    return text;
  }
  const type = String(mimeType || "").toLowerCase();
  if (type.indexOf("application/json") >= 0) {
    try {
      return JSON.stringify(sanitizeAny(JSON.parse(text)));
    } catch (error) {
      return text.replace(/("(?:[^"]*(?:jsessionid|token|password|pwd|passwd|fosu_password)[^"]*)"\s*:\s*)"[^"]*"/gi, `$1"${REDACTED}"`);
    }
  }
  if (type.indexOf("application/x-www-form-urlencoded") >= 0 || text.indexOf("=") >= 0) {
    return text
      .split("&")
      .map((part) => {
        const eqIndex = part.indexOf("=");
        if (eqIndex < 0) {
          return part;
        }
        const key = decodeURIComponent(part.slice(0, eqIndex).replace(/\+/g, " "));
        if (isSensitiveName(key)) {
          return `${part.slice(0, eqIndex + 1)}${encodeURIComponent(REDACTED)}`;
        }
        return part;
      })
      .join("&");
  }
  return text;
}

function sanitizePostData(postData) {
  if (!postData || typeof postData !== "object") {
    return postData;
  }
  const next = sanitizeAny(postData);
  if (Array.isArray(next.params)) {
    next.params = sanitizeNameValueList(next.params, "mask");
  }
  if (typeof next.text === "string") {
    next.text = sanitizePostText(next.text, next.mimeType);
  }
  return next;
}

function sanitizeRequest(request) {
  if (!request || typeof request !== "object") {
    return request;
  }
  const next = sanitizeAny(request);
  next.url = sanitizeUrl(next.url);
  next.headers = sanitizeNameValueList(next.headers, "mask");
  next.cookies = sanitizeNameValueList(next.cookies, "remove");
  next.queryString = sanitizeNameValueList(next.queryString, "mask");
  next.postData = sanitizePostData(next.postData);
  return next;
}

function sanitizeResponse(response) {
  if (!response || typeof response !== "object") {
    return response;
  }
  const next = sanitizeAny(response);
  next.headers = sanitizeNameValueList(next.headers, "mask");
  next.cookies = sanitizeNameValueList(next.cookies, "remove");
  return next;
}

function sanitizeAny(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeAny);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output = {};
  Object.keys(value).forEach((key) => {
    if (isSensitiveName(key)) {
      output[key] = REDACTED;
      return;
    }
    if (key === "request") {
      output[key] = sanitizeRequest(value[key]);
      return;
    }
    if (key === "response") {
      output[key] = sanitizeResponse(value[key]);
      return;
    }
    if (key === "url") {
      output[key] = sanitizeUrl(value[key]);
      return;
    }
    if (key === "postData") {
      output[key] = sanitizePostData(value[key]);
      return;
    }
    output[key] = sanitizeAny(value[key]);
  });
  return output;
}

if (!inputPath) {
  console.error("Usage: node tools/sanitize-har.js ./capture.har");
  process.exit(1);
}

const harPath = path.resolve(process.cwd(), inputPath);
const raw = fs.readFileSync(harPath, "utf8").replace(/^\uFEFF/, "");
const har = JSON.parse(raw);
const sanitized = sanitizeAny(har);

fs.writeFileSync(outputPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
console.log(`Sanitized HAR written to ${outputPath}`);
