const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const buffer = Buffer.from(JSON.stringify(data, null, 2), "utf-8");
  fs.writeFileSync(tempPath, buffer);
  try {
    if (process.platform === "win32" && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, buffer);
    try { fs.unlinkSync(tempPath); } catch (cleanupError) {}
  }
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function readFileBufferIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  } catch (error) {
    return null;
  }
}

function restoreFileBuffer(filePath, buffer) {
  ensureDir(path.dirname(filePath));
  if (buffer == null) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.restore.tmp`;
  fs.writeFileSync(tempPath, buffer);
  if (process.platform === "win32" && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (error) {}
  }
  fs.renameSync(tempPath, filePath);
}

function statJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    lastModified: stat.mtime.toUTCString(),
    etag: `"${crypto.createHash("sha1").update(`${filePath}:${stat.mtimeMs}:${stat.size}`).digest("hex")}"`,
  };
}

class SmallJsonCache {
  constructor(options = {}) {
    this.maxEntries = Math.max(10, Number(options.maxEntries || 100) || 100);
    this.cache = new Map();
  }

  read(filePath, fallback = null) {
    const stat = statJsonFile(filePath);
    if (!stat) return fallback;
    const key = path.resolve(filePath);
    const cached = this.cache.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cached.usedAt = Date.now();
      return cached.value;
    }
    const value = readJsonFile(filePath, fallback);
    this.cache.set(key, {
      value,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      usedAt: Date.now(),
    });
    this.prune();
    return value;
  }

  invalidate(filePath) {
    if (filePath) {
      this.cache.delete(path.resolve(filePath));
      return;
    }
    this.clear();
  }

  clear() {
    this.cache.clear();
  }

  prune() {
    if (this.cache.size <= this.maxEntries) return;
    Array.from(this.cache.entries())
      .sort((left, right) => Number(left[1].usedAt || 0) - Number(right[1].usedAt || 0))
      .slice(0, this.cache.size - this.maxEntries)
      .forEach(([key]) => this.cache.delete(key));
  }
}

module.exports = {
  SmallJsonCache,
  ensureDir,
  readFileBufferIfExists,
  readJsonFile,
  restoreFileBuffer,
  statJsonFile,
  writeJsonAtomic,
};
