"use strict";
const fs = require("fs");
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function gzipFile(input, output) {
  await pipeline(fs.createReadStream(input), zlib.createGzip({ level: 9 }), fs.createWriteStream(output, { mode: 0o600 }));
  return output;
}
function readChunk(file, start, endInclusive) {
  const bytes = Buffer.alloc(endInclusive - start + 1), fd = fs.openSync(file, "r");
  try { const count = fs.readSync(fd, bytes, 0, bytes.length, start); if (count !== bytes.length) throw new Error("UPLOAD_READ_INCOMPLETE"); return bytes; }
  finally { fs.closeSync(fd); }
}
module.exports = { hashFile, gzipFile, readChunk };
