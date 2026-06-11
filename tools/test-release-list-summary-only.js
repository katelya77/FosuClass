const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../server/src/services/releaseService.js"), "utf-8");
const start = source.indexOf("function listReleases");
assert(start >= 0, "listReleases should exist");
const end = source.indexOf("\nfunction ", start + 20);
const body = source.slice(start, end > start ? end : source.length);
assert(body.includes("releaseSummaryStore.readReleaseSummary"), "listReleases should read lightweight summaries");
assert(!/getReleasePackStatus|collectJsonFiles|readReleaseSnapshot|readActiveReleaseSnapshot/.test(body), "listReleases must not deep scan releases");

console.log("test-release-list-summary-only passed");
