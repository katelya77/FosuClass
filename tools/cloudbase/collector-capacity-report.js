"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { parseArgs } = require("./release-pack-utils");
function files(root) { return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isSymbolicLink() ? [] : entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)]); }
function measure(root) {
  const entries = files(root).filter((file) => file.endsWith(".json")).map((file) => {
    const raw = fs.readFileSync(file);
    return { path: path.relative(root, file).replace(/\\/g, "/"), rawBytes: raw.length, gzipBytes: zlib.gzipSync(raw).length };
  });
  return { fileCount: entries.length, rawBytes: entries.reduce((sum, item) => sum + item.rawBytes, 0), gzipBytes: entries.reduce((sum, item) => sum + item.gzipBytes, 0), hostingBytes: files(root).reduce((sum, file) => sum + fs.statSync(file).size, 0), indexes: entries.filter((item) => /^index\/(class|teacher|classroom|course)\/all.json$/.test(item.path)), entries };
}
function report(options) {
  const list = JSON.parse(fs.readFileSync(options.list, "utf8")), inventory = list.data || list.files || list;
  const groups = {};
  for (const file of inventory) { const group = (file.key || "").match(/^releases\/([^/]+)/); const name = group ? group[1] : "other"; const item = groups[name] || (groups[name] = { files: 0, bytes: 0 }); item.files++; item.bytes += Number(file.size || 0); }
  const release = measure(options.release);
  const queries = Number(options["queries-per-day"] || 0);
  const transfer = queries ? queries * 30 * Number(options["bytes-per-query"] || 0) : null;
  return { measuredAt: new Date().toISOString(), inventory: groups, release: Object.assign({}, release, { entries: undefined }), currentCapacitySafe: "UNKNOWN", quota: "UNKNOWN (billing API unavailable; verify console)", fiveReleaseHostingBytes: release.hostingBytes * 5, monthlyUploadRawBytesIfDailyChanged: release.hostingBytes * 30, monthlyStorageRetainedBytes: release.hostingBytes * 5, estimatedMonthlyTransfer: transfer || "UNKNOWN (requires measured queries/day and cache-hit ratio)", monthlyRequests: queries ? queries * 30 : "UNKNOWN", storageCost: "UNKNOWN (current plan price/quota required)", transferCost: "UNKNOWN", stagingSize: "UNKNOWN until approved school run", gzipMethod: "measured level 6; representation bytes, not observed CDN transfer" };
}
if (require.main === module) { const args = parseArgs(process.argv.slice(2)); console.log(JSON.stringify(report(args), null, 2)); }
module.exports = { measure, report };
