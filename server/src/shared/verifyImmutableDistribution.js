"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");

function fail(code) { return Object.assign(new Error(code), { code }); }
function safePath(value) {
  if (typeof value !== "string" || !value || /[\\%?#\x00-\x20]/.test(value) || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..")) throw fail("DISTRIBUTION_PATH_REJECTED");
  return value.split("/").map(encodeURIComponent).join("/");
}
function inventory(releaseDir, manifest) {
  if (!manifest || !manifest.files || typeof manifest.files !== "object") throw fail("DISTRIBUTION_MANIFEST_REJECTED");
  const entries = Object.entries(manifest.files).map(([relative, meta]) => {
    safePath(relative);
    if (!meta || !/^[a-f0-9]{40}$/.test(meta.hash || "") || !Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > 64 * 1024 * 1024) throw fail("DISTRIBUTION_FILE_META_REJECTED");
    return { ...meta, relative };
  });
  if (!entries.length || entries.length > 40000 || entries.reduce((sum, item) => sum + item.size, 0) > 1024 ** 3) throw fail("DISTRIBUTION_SIZE_BUDGET_REJECTED");
  const buffer = fs.readFileSync(path.join(releaseDir, "manifest.json"));
  return [{ relative: "manifest.json", size: buffer.length, hash: crypto.createHash("sha1").update(buffer).digest("hex") }, ...entries.filter(item => item.relative !== "manifest.json")];
}
function assertBaseUrl(value, fixtureOnly = false) {
  const base = new URL(value);
  const fixture = fixtureOnly === true && base.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(base.hostname);
  if ((!fixture && base.protocol !== "https:") || base.username || base.password || base.search || base.hash) throw fail("DISTRIBUTION_HTTPS_REQUIRED");
  return base;
}
async function verify(options) {
  const base = assertBaseUrl(options.releaseBaseUrl, options.fixtureOnly);
  const entries = inventory(options.releaseDir, options.manifest);
  const fetcher = options.fetcher || fetch, control = new AbortController();
  let index = 0, receivedBytes = 0, verifiedFiles = 0, firstError;
  async function worker() {
    while (index < entries.length && !firstError) {
      const item = entries[index++], timeout = AbortSignal.timeout(options.timeoutMs || 15000);
      try {
        const url = base.href.replace(/\/+$/g, "") + "/" + safePath(item.relative);
        const response = await fetcher(url, { redirect: "error", headers: { "accept-encoding": "identity" }, signal: AbortSignal.any([control.signal, timeout]) });
        if (!response.ok || !response.body) throw fail("DISTRIBUTION_FILE_UNAVAILABLE");
        const hash = crypto.createHash("sha1"), reader = response.body.getReader();
        let size = 0;
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.byteLength; receivedBytes += next.value.byteLength;
            if (size > item.size) throw fail("DISTRIBUTION_FILE_SIZE_MISMATCH");
            hash.update(next.value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (size !== item.size || hash.digest("hex") !== item.hash) throw fail("DISTRIBUTION_FILE_HASH_MISMATCH");
        verifiedFiles++;
      } catch (error) {
        if (!firstError) { firstError = error.code && error.code.startsWith("DISTRIBUTION_") ? error : fail("DISTRIBUTION_REQUEST_FAILED"); control.abort(); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, options.concurrency || 2)) }, worker));
  if (firstError) throw firstError;
  return { success: true, verifiedFiles, expectedBytes: entries.reduce((sum, item) => sum + item.size, 0), receivedBytes, complete: verifiedFiles === entries.length };
}
module.exports = { assertBaseUrl, inventory, safePath, verify };
