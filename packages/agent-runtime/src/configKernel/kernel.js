// P4a：统一配置发布内核（Artifact Repository and Config Publication Kernel）。
//
// 发布链：draft → validate → test → publish → immutable configVersion →
// 新 Run 原子绑定快照 → hot reload → rollback。六域共用本内核；域差异收敛在
// Domain Adapter（validate/test/composeSnapshotEntry/resolveRuntime）。
//
// 语义保证：
// - 版本文档不可变；草稿永远不进生产（生产只读已发布版本组成的快照）。
// - validate/test 失败不移动发布指针；publish 要求同一份草稿已通过 validate+test。
// - rollback 只切已发布（=已验证）历史版本；每次发布/回滚生成新快照与
//   新 configVersion，旧快照仍可解析（在途 Run 稳定）。
// - current 引用原子切换；读取失败回退 last-known-good；损坏 fail closed，
//   绝不静默重置为空配置。
// - seed 只初始化空环境或升级 seed-origin 版本；admin 发布的版本不被种子覆盖。

const { jsonClone, sha256Digest } = require("./canonical");
const { codedError } = require("./errors");

const SNAPSHOT_SCHEMA = "config-snapshot.v1";
const VERSION_SCHEMA = "config-artifact.v1";

// 草稿必须可 JSON 持久化（声明式；拒绝函数/undefined 字段偷渡执行内容）。
function assertDeclarative(value, path) {
  if (value === null) return;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return;
  if (type === "undefined" || type === "function" || type === "symbol" || type === "bigint") {
    throw codedError("CONFIG_KERNEL_PAYLOAD_NOT_DECLARATIVE", `payload field ${path} is not declarative data`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDeclarative(item, `${path}[${index}]`));
    return;
  }
  if (type === "object") {
    Object.keys(value).forEach((key) => assertDeclarative(value[key], path ? `${path}.${key}` : key));
    return;
  }
  throw codedError("CONFIG_KERNEL_PAYLOAD_NOT_DECLARATIVE", `payload field ${path} is not declarative data`);
}

function noopLogger() {}

function createConfigKernel(options = {}) {
  const repository = options.repository;
  if (!repository || typeof repository.putVersion !== "function") {
    throw codedError("CONFIG_KERNEL_REPOSITORY_REQUIRED", "a config kernel repository is required");
  }
  const domainAdapters = options.domainAdapters || {};
  const environments = (Array.isArray(options.environments) && options.environments.length
    ? options.environments
    : ["public", "trial", "dev"]).map((env) => String(env));
  const logger = typeof options.logger === "function" ? options.logger : noopLogger;
  const now = typeof options.clock === "function" ? options.clock : () => new Date().toISOString();

  function requireAdapter(domain) {
    const adapter = domainAdapters[domain];
    if (!adapter || typeof adapter.validate !== "function" || typeof adapter.test !== "function") {
      throw codedError("CONFIG_KERNEL_DOMAIN_ADAPTER_REQUIRED", `no domain adapter registered for ${domain}`);
    }
    return adapter;
  }

  function requireEnvironment(environment) {
    const env = String(environment || "");
    if (!environments.includes(env)) {
      throw codedError("CONFIG_KERNEL_ENVIRONMENT_INVALID", `unknown environment: ${env || "(empty)"}`);
    }
    return env;
  }

  function audit(entry) {
    try {
      repository.appendAudit(Object.assign({ at: now() }, entry));
    } catch (error) {
      logger({ level: "warn", event: "config-kernel-audit-failed", code: error && error.code });
    }
  }

  function composeSnapshot(environment, pointers) {
    const artifacts = {};
    Object.keys(pointers.artifacts || {}).sort().forEach((key) => {
      const version = pointers.artifacts[key];
      const separator = key.indexOf(":");
      const domain = key.slice(0, separator);
      const artifactId = key.slice(separator + 1);
      const doc = repository.getVersion(domain, artifactId, environment, version);
      if (!doc) {
        throw codedError("CONFIG_KERNEL_VERSION_MISSING", `published version ${key}#${version} is missing`);
      }
      const adapter = domainAdapters[domain];
      const entry = {
        domain,
        artifactId,
        version: doc.version,
        digest: doc.digest,
      };
      if (adapter && typeof adapter.composeSnapshotEntry === "function") {
        entry.summary = adapter.composeSnapshotEntry(doc) || null;
      }
      artifacts[key] = entry;
    });
    const seq = Number(pointers.seq) || 0;
    const configVersion = `cfg-${environment}-${String(seq).padStart(4, "0")}-${sha256Digest(artifacts).slice(0, 12)}`;
    const content = {
      schemaVersion: SNAPSHOT_SCHEMA,
      configVersion,
      environment,
      capturedAt: now(),
      artifacts,
    };
    return Object.assign({}, content, { digest: sha256Digest(content) });
  }

  function activateSnapshot(environment, snapshot) {
    repository.putSnapshot(snapshot);
    repository.writeCurrentRef(environment, snapshot.configVersion);
    repository.writeLkg(environment, snapshot);
    return snapshot;
  }

  function publishVersion(environment, draft, actor, origin) {
    const key = `${draft.domain}:${draft.artifactId}`;
    const existing = repository.listVersions(draft.domain, draft.artifactId, environment);
    const version = existing.length ? existing[existing.length - 1] + 1 : 1;
    const payload = jsonClone(draft.payload);
    const content = {
      schemaVersion: VERSION_SCHEMA,
      domain: draft.domain,
      artifactId: draft.artifactId,
      environment,
      version,
      payload,
      origin: origin || draft.origin || "admin",
      sourceDigest: draft.sourceDigest || null,
      createdAt: now(),
      createdBy: String(actor || "system").slice(0, 120),
    };
    const doc = Object.assign({}, content, { digest: sha256Digest(content) });
    repository.putVersion(doc);
    const pointers = repository.readPointers(environment);
    pointers.artifacts = Object.assign({}, pointers.artifacts, { [key]: version });
    pointers.seq = Number(pointers.seq || 0) + 1;
    pointers.updatedAt = now();
    repository.writePointers(pointers);
    const snapshot = activateSnapshot(environment, composeSnapshot(environment, pointers));
    audit({
      op: origin === "seed" ? "seed.publish" : "publish",
      domain: draft.domain,
      artifactId: draft.artifactId,
      environment,
      version,
      configVersion: snapshot.configVersion,
      actor: content.createdBy,
      result: "ok",
    });
    return { version, configVersion: snapshot.configVersion, snapshot };
  }

  return Object.freeze({
    environments: Object.freeze(environments.slice()),

    saveDraft(input = {}) {
      const environment = requireEnvironment(input.environment);
      const adapter = requireAdapter(input.domain);
      const artifactId = String(input.artifactId || "");
      if (!artifactId) throw codedError("CONFIG_KERNEL_ARTIFACT_ID_REQUIRED");
      if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
        throw codedError("CONFIG_KERNEL_PAYLOAD_INVALID", "payload must be a plain object");
      }
      // 草稿必须可 JSON 持久化（声明式；拒绝函数/undefined 字段偷渡执行内容）。
      assertDeclarative(input.payload, "");
      const payload = jsonClone(input.payload);
      const published = repository.readPointers(environment).artifacts[`${input.domain}:${artifactId}`] || 0;
      const draft = {
        domain: String(input.domain),
        artifactId,
        environment,
        payload,
        baseVersion: published,
        origin: "admin",
        sourceDigest: null,
        updatedAt: now(),
        updatedBy: String(input.actor || "admin").slice(0, 120),
        validation: null,
        test: null,
      };
      repository.putDraft(draft);
      audit({ op: "draft.save", domain: draft.domain, artifactId, environment, actor: draft.updatedBy, result: "ok" });
      return draft;
    },

    getDraft(input = {}) {
      const environment = requireEnvironment(input.environment);
      return repository.getDraft(String(input.domain), String(input.artifactId || ""), environment);
    },

    validateDraft(input = {}) {
      const environment = requireEnvironment(input.environment);
      const adapter = requireAdapter(input.domain);
      const draft = repository.getDraft(String(input.domain), String(input.artifactId || ""), environment);
      if (!draft) throw codedError("CONFIG_KERNEL_DRAFT_NOT_FOUND");
      const report = adapter.validate(draft.payload) || {};
      const ok = report.ok === true;
      draft.validation = {
        ok,
        errors: (Array.isArray(report.errors) ? report.errors : []).slice(0, 32).map((item) => String(item).slice(0, 200)),
        at: now(),
        by: String(input.actor || "admin").slice(0, 120),
      };
      draft.test = null;
      repository.putDraft(draft);
      audit({
        op: "draft.validate",
        domain: draft.domain,
        artifactId: draft.artifactId,
        environment,
        actor: draft.validation.by,
        result: ok ? "ok" : "failed",
        reasonCode: ok ? "" : "CONFIG_KERNEL_VALIDATION_FAILED",
      });
      return Object.freeze({ ok, errors: draft.validation.errors.slice(), normalized: ok && report.normalized ? jsonClone(report.normalized) : null });
    },

    testDraft(input = {}) {
      const environment = requireEnvironment(input.environment);
      const adapter = requireAdapter(input.domain);
      const draft = repository.getDraft(String(input.domain), String(input.artifactId || ""), environment);
      if (!draft) throw codedError("CONFIG_KERNEL_DRAFT_NOT_FOUND");
      if (!draft.validation || draft.validation.ok !== true) {
        throw codedError("CONFIG_KERNEL_VALIDATION_REQUIRED", "draft must pass validation before testing");
      }
      const validation = adapter.validate(draft.payload) || {};
      if (validation.ok !== true) {
        throw codedError("CONFIG_KERNEL_VALIDATION_STALE", "draft no longer passes validation");
      }
      const report = adapter.test(validation.normalized || draft.payload) || {};
      const ok = report.ok === true;
      draft.test = {
        ok,
        results: jsonClone(report.results || {}) || {},
        at: now(),
        by: String(input.actor || "admin").slice(0, 120),
      };
      repository.putDraft(draft);
      audit({
        op: "draft.test",
        domain: draft.domain,
        artifactId: draft.artifactId,
        environment,
        actor: draft.test.by,
        result: ok ? "ok" : "failed",
        reasonCode: ok ? "" : "CONFIG_KERNEL_TEST_FAILED",
      });
      return Object.freeze({ ok, results: draft.test.results });
    },

    publishDraft(input = {}) {
      const environment = requireEnvironment(input.environment);
      const draft = repository.getDraft(String(input.domain), String(input.artifactId || ""), environment);
      if (!draft) throw codedError("CONFIG_KERNEL_DRAFT_NOT_FOUND");
      if (!draft.validation || draft.validation.ok !== true) {
        throw codedError("CONFIG_KERNEL_VALIDATION_REQUIRED", "draft must pass validation before publish");
      }
      if (!draft.test || draft.test.ok !== true) {
        throw codedError("CONFIG_KERNEL_TEST_REQUIRED", "draft must pass testing before publish");
      }
      const outcome = publishVersion(environment, draft, input.actor, "admin");
      return Object.freeze({ version: outcome.version, configVersion: outcome.configVersion });
    },

    rollback(input = {}) {
      const environment = requireEnvironment(input.environment);
      const domain = String(input.domain);
      const artifactId = String(input.artifactId || "");
      const toVersion = Number(input.toVersion);
      // 只有已发布版本可被回滚：版本文档只由 publish 产生，存在即已验证。
      const doc = repository.getVersion(domain, artifactId, environment, toVersion);
      if (!doc) {
        throw codedError("CONFIG_KERNEL_ROLLBACK_TARGET_NOT_FOUND", "rollback target must be a published version");
      }
      const key = `${domain}:${artifactId}`;
      const pointers = repository.readPointers(environment);
      if (!pointers.artifacts[key]) {
        throw codedError("CONFIG_KERNEL_ROLLBACK_TARGET_NOT_FOUND", "artifact has no publication history");
      }
      pointers.artifacts = Object.assign({}, pointers.artifacts, { [key]: doc.version });
      pointers.seq = Number(pointers.seq || 0) + 1;
      pointers.updatedAt = now();
      repository.writePointers(pointers);
      const snapshot = activateSnapshot(environment, composeSnapshot(environment, pointers));
      audit({
        op: "rollback",
        domain,
        artifactId,
        environment,
        version: doc.version,
        configVersion: snapshot.configVersion,
        actor: String(input.actor || "admin").slice(0, 120),
        result: "ok",
      });
      return Object.freeze({ version: doc.version, configVersion: snapshot.configVersion });
    },

    // 新 Run 的绑定入口：读取当前不可变快照。读取/校验失败回退 LKG；
    // 从未初始化（无 current 且无 LKG）返回 null，由调用方决定保底行为。
    getCurrentSnapshot(environment) {
      const env = requireEnvironment(environment);
      let ref = null;
      try {
        ref = repository.readCurrentRef(env);
        if (ref && ref.configVersion) {
          const snapshot = repository.getSnapshot(env, ref.configVersion);
          if (snapshot) return Object.freeze(jsonClone(snapshot));
        }
      } catch (error) {
        logger({ level: "warn", event: "config-kernel-current-unreadable", environment: env, code: error && error.code });
      }
      try {
        const lkg = repository.readLkg(env);
        if (lkg) {
          logger({ level: "warn", event: "config-kernel-serving-lkg", environment: env });
          return Object.freeze(jsonClone(lkg));
        }
      } catch (error) {
        logger({ level: "warn", event: "config-kernel-lkg-unreadable", environment: env, code: error && error.code });
      }
      // 曾经发布过（有快照）但当前引用与 LKG 均不可读：fail closed。
      if (repository.listSnapshots(env).length) {
        throw codedError("CONFIG_KERNEL_SNAPSHOT_UNREADABLE", "published configuration exists but cannot be read");
      }
      return null;
    },

    getArtifactVersion(input = {}) {
      const environment = requireEnvironment(input.environment);
      const doc = repository.getVersion(String(input.domain), String(input.artifactId || ""), environment, Number(input.version));
      if (!doc) throw codedError("CONFIG_KERNEL_VERSION_MISSING");
      return Object.freeze(jsonClone(doc));
    },

    listHistory(input = {}) {
      const environment = requireEnvironment(input.environment);
      const domain = String(input.domain);
      const artifactId = String(input.artifactId || "");
      const versions = repository.listVersions(domain, artifactId, environment);
      const current = repository.readPointers(environment).artifacts[`${domain}:${artifactId}`] || null;
      return Object.freeze(versions.map((version) => {
        const doc = repository.getVersion(domain, artifactId, environment, version);
        return Object.freeze({
          version,
          origin: doc && doc.origin || "admin",
          createdAt: doc && doc.createdAt || "",
          createdBy: doc && doc.createdBy || "",
          digest: doc && doc.digest || "",
          current: current === version,
        });
      }));
    },

    listAudit(input = {}) {
      return Object.freeze(repository.listAudit({ limit: input.limit }));
    },

    // 种子：仅当环境从未发布过时初始化；已发布且当前版本为 seed-origin 且
    // sourceDigest 变化时自动升级种子版本；admin-origin 版本永不被种子触碰。
    seedEnvironment(environment, seeds = []) {
      const env = requireEnvironment(environment);
      const hasSnapshots = repository.listSnapshots(env).length > 0;
      const results = [];
      (Array.isArray(seeds) ? seeds : []).forEach((seed) => {
        const adapter = requireAdapter(seed.domain);
        const validation = adapter.validate(seed.payload) || {};
        if (validation.ok !== true) {
          throw codedError("CONFIG_KERNEL_SEED_INVALID", `seed payload for ${seed.domain}:${seed.artifactId} failed validation`);
        }
        const testReport = adapter.test(validation.normalized || seed.payload) || {};
        if (testReport.ok !== true) {
          throw codedError("CONFIG_KERNEL_SEED_INVALID", `seed payload for ${seed.domain}:${seed.artifactId} failed testing`);
        }
        const key = `${seed.domain}:${seed.artifactId}`;
        const pointers = repository.readPointers(env);
        const publishedVersion = pointers.artifacts[key] || 0;
        if (!hasSnapshots) {
          const outcome = publishVersion(env, {
            domain: String(seed.domain),
            artifactId: String(seed.artifactId),
            payload: seed.payload,
            origin: "seed",
            sourceDigest: seed.sourceDigest || null,
          }, "system", "seed");
          results.push({ key, action: "initialized", version: outcome.version });
          return;
        }
        if (!publishedVersion) {
          const outcome = publishVersion(env, {
            domain: String(seed.domain),
            artifactId: String(seed.artifactId),
            payload: seed.payload,
            origin: "seed",
            sourceDigest: seed.sourceDigest || null,
          }, "system", "seed");
          results.push({ key, action: "added", version: outcome.version });
          return;
        }
        const current = repository.getVersion(String(seed.domain), String(seed.artifactId), env, publishedVersion);
        if (current && current.origin === "seed" && seed.sourceDigest && current.sourceDigest !== seed.sourceDigest) {
          const outcome = publishVersion(env, {
            domain: String(seed.domain),
            artifactId: String(seed.artifactId),
            payload: seed.payload,
            origin: "seed",
            sourceDigest: seed.sourceDigest || null,
          }, "system", "seed");
          results.push({ key, action: "upgraded", version: outcome.version });
          return;
        }
        results.push({ key, action: "kept", version: publishedVersion });
      });
      return Object.freeze(results);
    },

    diagnostics(environment) {
      const env = requireEnvironment(environment);
      const pointers = repository.readPointers(env);
      let current = null;
      try {
        const ref = repository.readCurrentRef(env);
        current = ref && ref.configVersion || null;
      } catch (_) {
        current = null;
      }
      return Object.freeze({
        environment: env,
        configVersion: current,
        artifacts: Object.freeze(Object.assign({}, pointers.artifacts)),
        snapshotCount: repository.listSnapshots(env).length,
        lkgAvailable: (() => {
          try { return Boolean(repository.readLkg(env)); } catch (_) { return false; }
        })(),
      });
    },
  });
}

module.exports = Object.freeze({
  SNAPSHOT_SCHEMA,
  VERSION_SCHEMA,
  createConfigKernel,
});
