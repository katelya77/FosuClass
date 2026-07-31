// P4a：Config Kernel 的文件系统 Repository（integrated 模式默认适配器）。
// P5a 的 PostgreSQL 适配器实现同一方法集（REPOSITORY_METHODS），共用
// repositoryConformance 契约测试。
//
// 布局（root 由调用方注入；本包不读取任何环境变量）：
//   artifacts/<domain>/<artifactId>/<env>/v<version>.json   不可变版本文档（含 digest）
//   drafts/<domain>/<artifactId>/<env>.json                 可变草稿文档
//   pointers/<env>.json                                     当前发布指针 {seq, artifacts}
//   snapshots/<env>/<configVersion>.json                    不可变快照（含 digest）
//   current/<env>.json                                      当前快照引用（原子切换的发布点）
//   lkg/<env>.json                                          最近有效快照副本（last-known-good）
//   audit/audit.jsonl                                       追加式审计
//
// 持久化纪律：tmp+rename 原子写 + fsync；不可变文档读取时校验 digest；
// current 引用解析失败抛 CONFIG_KERNEL_STORAGE_CORRUPT，由内核回退 LKG，
// 绝不静默重置为空配置。

const fs = require("fs");
const path = require("path");
const { sha256Digest } = require("./canonical");
const { codedError } = require("./errors");

const REPOSITORY_METHODS = Object.freeze([
  "putDraft",
  "getDraft",
  "putVersion",
  "getVersion",
  "listVersions",
  "readPointers",
  "writePointers",
  "putSnapshot",
  "getSnapshot",
  "listSnapshots",
  "readCurrentRef",
  "writeCurrentRef",
  "writeLkg",
  "readLkg",
  "appendAudit",
  "listAudit",
]);

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function safeSegment(value, name) {
  const text = String(value || "");
  if (!SAFE_SEGMENT.test(text)) {
    throw codedError("CONFIG_KERNEL_PATH_SEGMENT_INVALID", `${name} contains unsafe characters`);
  }
  return text;
}

function safeVersion(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 1e9) {
    throw codedError("CONFIG_KERNEL_VERSION_INVALID", "version must be a positive integer");
  }
  return num;
}

function createConfigKernelFileRepository(options = {}) {
  const root = String(options.root || "");
  if (!root) throw codedError("CONFIG_KERNEL_ROOT_REQUIRED", "repository root is required");

  function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  function fsyncFile(file) {
    let fd = null;
    try {
      // Windows 上 fsync 需要写权限句柄；只读句柄会 EPERM。
      fd = fs.openSync(file, "r+");
      fs.fsyncSync(fd);
    } catch (error) {
      // 目录/文件 fsync 在部分平台不可用（EPERM/EINVAL），尽力而为；
      // 原子性由 tmp+rename 保证，fsync 只是持久性加固。
      if (!error || !["EPERM", "EINVAL"].includes(error.code)) throw error;
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch (_) { /* ignore */ }
      }
    }
  }

  function fsyncDir(dir) {
    try {
      const fd = fs.openSync(dir, "r");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch (_) {
      // 目录 fsync 在部分平台不可用，尽力而为。
    }
  }

  function writeJsonAtomic(file, value) {
    ensureDir(path.dirname(file));
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    const data = JSON.stringify(value, null, 2);
    fs.writeFileSync(tmp, data, { encoding: "utf8", mode: 0o600 });
    fsyncFile(tmp);
    fs.renameSync(tmp, file);
    fsyncDir(path.dirname(file));
  }

  function readJson(file, { verifyDigest = false } = {}) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (_) {
      throw codedError("CONFIG_KERNEL_STORAGE_CORRUPT", `stored document is not valid JSON: ${path.basename(file)}`);
    }
    if (verifyDigest && doc && typeof doc === "object") {
      const content = Object.assign({}, doc);
      const expected = content.digest;
      delete content.digest;
      if (typeof expected !== "string" || sha256Digest(content) !== expected) {
        throw codedError("CONFIG_KERNEL_STORAGE_CORRUPT", `stored document digest mismatch: ${path.basename(file)}`);
      }
    }
    return doc;
  }

  function artifactDir(domain, artifactId, env) {
    return path.join(
      root,
      "artifacts",
      safeSegment(domain, "domain"),
      safeSegment(artifactId, "artifactId"),
      safeSegment(env, "environment")
    );
  }

  function versionFile(domain, artifactId, env, version) {
    return path.join(artifactDir(domain, artifactId, env), `v${safeVersion(version)}.json`);
  }

  function draftFile(domain, artifactId, env) {
    return path.join(
      root,
      "drafts",
      safeSegment(domain, "domain"),
      safeSegment(artifactId, "artifactId"),
      `${safeSegment(env, "environment")}.json`
    );
  }

  function pointersFile(env) {
    return path.join(root, "pointers", `${safeSegment(env, "environment")}.json`);
  }

  function snapshotFile(env, configVersion) {
    return path.join(
      root,
      "snapshots",
      safeSegment(env, "environment"),
      `${safeSegment(configVersion, "configVersion")}.json`
    );
  }

  function currentFile(env) {
    return path.join(root, "current", `${safeSegment(env, "environment")}.json`);
  }

  function lkgFile(env) {
    return path.join(root, "lkg", `${safeSegment(env, "environment")}.json`);
  }

  function auditFile() {
    return path.join(root, "audit", "audit.jsonl");
  }

  return Object.freeze({
    kind: "file",

    putDraft(draft) {
      writeJsonAtomic(draftFile(draft.domain, draft.artifactId, draft.environment), draft);
      return draft;
    },

    getDraft(domain, artifactId, env) {
      return readJson(draftFile(domain, artifactId, env));
    },

    putVersion(doc) {
      const file = versionFile(doc.domain, doc.artifactId, doc.environment, doc.version);
      if (fs.existsSync(file)) {
        throw codedError("CONFIG_KERNEL_VERSION_EXISTS", "artifact versions are immutable");
      }
      writeJsonAtomic(file, doc);
      return doc;
    },

    getVersion(domain, artifactId, env, version) {
      return readJson(versionFile(domain, artifactId, env, version), { verifyDigest: true });
    },

    listVersions(domain, artifactId, env) {
      const dir = artifactDir(domain, artifactId, env);
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch (error) {
        if (error && error.code === "ENOENT") return [];
        throw error;
      }
      return names
        .map((name) => /^v(\d+)\.json$/.exec(name))
        .filter(Boolean)
        .map((match) => Number(match[1]))
        .sort((a, b) => a - b);
    },

    readPointers(env) {
      return readJson(pointersFile(env)) || { environment: safeSegment(env, "environment"), seq: 0, artifacts: {} };
    },

    writePointers(doc) {
      writeJsonAtomic(pointersFile(doc.environment), doc);
      return doc;
    },

    putSnapshot(doc) {
      writeJsonAtomic(snapshotFile(doc.environment, doc.configVersion), doc);
      return doc;
    },

    getSnapshot(env, configVersion) {
      return readJson(snapshotFile(env, configVersion), { verifyDigest: true });
    },

    listSnapshots(env) {
      const dir = path.join(root, "snapshots", safeSegment(env, "environment"));
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch (error) {
        if (error && error.code === "ENOENT") return [];
        throw error;
      }
      return names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
    },

    readCurrentRef(env) {
      return readJson(currentFile(env));
    },

    writeCurrentRef(env, configVersion) {
      const doc = { environment: safeSegment(env, "environment"), configVersion: safeSegment(configVersion, "configVersion"), updatedAt: new Date().toISOString() };
      writeJsonAtomic(currentFile(env), doc);
      return doc;
    },

    writeLkg(env, snapshot) {
      writeJsonAtomic(lkgFile(env), snapshot);
      return snapshot;
    },

    readLkg(env) {
      return readJson(lkgFile(env), { verifyDigest: true });
    },

    appendAudit(entry) {
      ensureDir(path.dirname(auditFile()));
      fs.appendFileSync(auditFile(), `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
      return entry;
    },

    listAudit(options2 = {}) {
      let raw;
      try {
        raw = fs.readFileSync(auditFile(), "utf8");
      } catch (error) {
        if (error && error.code === "ENOENT") return [];
        throw error;
      }
      const limit = Math.max(1, Math.min(500, Number(options2.limit) || 100));
      return raw
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((line) => JSON.parse(line));
    },
  });
}

module.exports = Object.freeze({
  REPOSITORY_METHODS,
  createConfigKernelFileRepository,
});
