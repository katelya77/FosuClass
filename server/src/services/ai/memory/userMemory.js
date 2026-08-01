/**
 * User long-term low-risk memory — wraps UserPreferenceService + optional meta.
 */

const crypto = require("crypto");
const { defaultUserPreferenceService, ALLOWED_KEYS, normalizeValue } = require("../conversation/userPreferenceService");
const {
  filterAndMergeCandidates,
  enforceUserMemoryCap,
  MAX_USER_MEMORIES,
  isExpired,
  effectiveExpiryMs,
  isLowRiskKey,
  resolveTtlMs,
} = require("./memoryPolicy");
const { validateMemoryCandidates } = require("./memorySemanticValidator");

const EXTENDED_KEYS = Object.freeze([
  ...ALLOWED_KEYS,
  "preferredBuilding",
  "answerDetailLevel",
  "preferredClassName",
  "preferPersonalSchedule",
]);

// maybe-async 透传（P5a WS6）：file 后端同步返回原值；postgres 后端返回 Promise。
// 吞错语义用 chain 的 onRejected 保持——原 try/catch 的"任何异常 → 空结果"不变。
function isThenable(value) {
  return Boolean(value) && typeof value.then === "function";
}

function chain(value, onFulfilled, onRejected) {
  if (!isThenable(value)) return onFulfilled(value);
  return value.then(onFulfilled, onRejected);
}

/**
 * memory.write_* 结构化事件（M1）：区分 write_succeeded / write_retried /
 * write_skipped / write_failed。事件只携带非敏感标识（revision 数字、变更类别、
 * runId、conversationId 哈希、policyVersion、时间戳），绝不记录记忆正文/键值。
 */
const MEMORY_WRITE_EVENT_LIMIT = 200;
const memoryWriteEvents = [];

function hashSafeId(value) {
  return crypto.createHash("sha256").update(String(value || "anonymous")).digest("hex").slice(0, 16);
}

function safeEventText(value, max = 100) {
  return String(value == null ? "" : value).replace(/[\r\n\t]/g, " ").trim().slice(0, max);
}

// 检索上限解析（P4b 审查跟进）：显式 input.limit 优先；否则发布策略的
// maxRetrieve（适配器已约束 1..10）；都没有回落静态默认 5。此前调用方
// 硬编码 limit=5，发布的 maxRetrieve 旋钮在生产读路径不可达。
function resolveMemoryLimit(input = {}, fallback = 5) {
  if (Number.isInteger(input.limit) && input.limit > 0) return input.limit;
  const policyValue = input.policy && Number(input.policy.maxRetrieve);
  if (Number.isInteger(policyValue) && policyValue >= 1 && policyValue <= 10) return policyValue;
  return fallback;
}

function emitMemoryWriteEvent(event = {}) {
  const entry = {
    event: safeEventText(event.event, 40),
    reason: safeEventText(event.reason, 80),
    attemptCount: Math.max(0, Number(event.attemptCount || 0) || 0),
    oldRevision: event.oldRevision === undefined || event.oldRevision === null ? null : Number(event.oldRevision),
    latestRevision: event.latestRevision === undefined || event.latestRevision === null ? null : Number(event.latestRevision),
    mutationCategories: (Array.isArray(event.mutationCategories) ? event.mutationCategories : [])
      .map((category) => safeEventText(category, 24)).filter(Boolean).slice(0, 8),
    mutationCount: Math.max(0, Number(event.mutationCount || 0) || 0),
    runId: safeEventText(event.runId, 100),
    conversationIdHash: event.conversationId ? hashSafeId(event.conversationId) : "",
    policyVersion: safeEventText(event.policyVersion, 100),
    boundaryConflicts: (Array.isArray(event.boundaryConflicts) ? event.boundaryConflicts : [])
      .map((code) => safeEventText(code, 60)).filter(Boolean).slice(0, 8),
    at: new Date().toISOString(),
  };
  memoryWriteEvents.push(entry);
  if (memoryWriteEvents.length > MEMORY_WRITE_EVENT_LIMIT) {
    memoryWriteEvents.splice(0, memoryWriteEvents.length - MEMORY_WRITE_EVENT_LIMIT);
  }
  return entry;
}

function listMemoryWriteEventsForTest() {
  return memoryWriteEvents.map((entry) => Object.assign({}, entry, {
    mutationCategories: entry.mutationCategories.slice(),
    boundaryConflicts: entry.boundaryConflicts.slice(),
  }));
}

function clearMemoryWriteEventsForTest() {
  memoryWriteEvents.length = 0;
}

/**
 * 写错误准确分类（M1）：Schema/权限/认证/存储错误不伪装成 revision conflict。
 */
function classifyMemoryWriteError(error) {
  const code = String(error && error.code || "");
  if (code === "MEMORY_REVISION_CONFLICT") return "revision_conflict";
  if (code === "PRINCIPAL_REQUIRED" || code === "FOSU_SESSION_REQUIRED") return "auth";
  if (code === "MEMORY_SECRET_UNAVAILABLE" || code.indexOf("USER_PREFERENCE_LOCK") === 0) return "storage_unavailable";
  if (code === "MEMORY_DOCUMENT_CORRUPT") return "storage_corrupt";
  if (code === "MEMORY_SCHEMA_UNSUPPORTED") return "schema_unsupported";
  if (/^(MEMORY_KIND_FORBIDDEN|MEMORY_KEY_INVALID|MEMORY_VALUE_INVALID|MEMORY_SEMANTIC_INVALID(?:_PREFERRED_NAME)?|MEMORY_QUESTION_NOT_FACT|MEMORY_SENSITIVE_REJECTED|PREFERENCE_INVALID)$/.test(code)) {
    return "schema_validation";
  }
  return "storage_error";
}

/**
 * canonical 学期/Release 边界（Low#3）：权威边界（releaseContext → controller 传入）
 * 是新写的唯一事实源；candidate 级 legacy 字段仅在权威边界缺失时确定性补位；
 * 冲突按 provenance（权威边界 > 抽取遗留）取权威并记结构化冲突原因。
 */
function resolveCanonicalBoundary(candidate = {}, input = {}) {
  const authoritativeTerm = safeEventText(input.termId, 60);
  const authoritativeRelease = safeEventText(input.releaseVersion, 100);
  const legacyTerm = safeEventText(candidate.termId, 60);
  const legacyRelease = safeEventText(candidate.releaseVersion, 100);
  const boundaryConflicts = [];
  if (authoritativeTerm && legacyTerm && authoritativeTerm !== legacyTerm) {
    boundaryConflicts.push("term_boundary_conflict");
  }
  if (authoritativeRelease && legacyRelease && authoritativeRelease !== legacyRelease) {
    boundaryConflicts.push("release_boundary_conflict");
  }
  return {
    termId: authoritativeTerm || legacyTerm,
    releaseVersion: authoritativeRelease || legacyRelease,
    boundaryConflicts,
  };
}

function toMemoryItems(values = {}, meta = {}, policy = null) {
  return EXTENDED_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(values, key) && values[key] != null && values[key] !== "")
    .map((key) => {
      const itemMeta = meta[key] || {};
      // Low#4：legacy 缺 expiresAt 时用 updatedAt → createdAt 起算 + 类别默认 TTL，
      // 不做"当前时间 + 默认 TTL"复活；无法确认有效性则保持空串并由 isExpired fail closed。
      const effectiveExpiry = effectiveExpiryMs({
        key,
        scope: "user",
        expiresAt: itemMeta.expiresAt || "",
        updatedAt: itemMeta.updatedAt || "",
        createdAt: itemMeta.createdAt || "",
      }, policy);
      return {
        key,
        value: values[key],
        type: key === "preferredName" || key === "college" || key === "major" || key === "grade" ? "identity"
          : key === "campus" || key === "preferredBuilding" ? "location_pref"
            : key === "defaultReminderLeadMinutes" ? "reminder_pref"
              : key.indexOf("Schedule") >= 0 || key.indexOf("Class") >= 0 ? "schedule_pref"
                : "style_pref",
        scope: "user",
        confidence: Number(itemMeta.confidence || 0.9),
        reasonCode: itemMeta.reasonCode || "stored",
        correction: Boolean(itemMeta.correction),
        updatedAt: itemMeta.updatedAt || "",
        expiresAt: effectiveExpiry === null ? "" : new Date(effectiveExpiry).toISOString(),
        sensitivity: "low",
        sourceTurnIds: itemMeta.sourceTurnIds || [],
        provenance: itemMeta.provenance || { type: "legacy_projection" },
        status: itemMeta.status || "active",
        memoryId: itemMeta.memoryId || `legacy:${key}`,
        supersedes: itemMeta.supersedes || "",
        termId: itemMeta.termId || "",
        releaseVersion: itemMeta.releaseVersion || "",
      };
    })
    .filter((item) => !isExpired(item, Date.now(), policy));
}

class UserMemoryStore {
  constructor(options = {}) {
    this.preferenceService = options.preferenceService || defaultUserPreferenceService;
  }

  load(input = {}) {
    const principal = input.principal;
    const memoryMode = input.memoryMode || "local_only";
    const empty = { items: [], values: {}, episodes: [], revision: 0, policy: null };
    if (!principal || principal.authenticated !== true) {
      return empty;
    }
    // User Memory is cloud_sync only; session_state must not restore cross-conversation prefs.
    if (memoryMode !== "cloud_sync") {
      return empty;
    }
    const finish = (listed) => {
      try {
        const items = listed
          ? listed.items.map((item) => ({ ...item, value: item.normalizedValue }))
          : enforceUserMemoryCap(toMemoryItems(this.preferenceService.getObject({ principal }) || {}, {}, input.policy || null), undefined, input.policy || null);
        const values = Object.fromEntries(items.map((item) => [item.key, item.value]));
        return { items, values, episodes: [], revision: listed && listed.revision || 0, policy: listed && listed.policy || null };
      } catch (_) {
        return empty;
      }
    };
    try {
      const listed = typeof this.preferenceService.listMemoryItems === "function"
        ? this.preferenceService.listMemoryItems({ principal, pageSize: MAX_USER_MEMORIES })
        : null;
      return chain(listed, finish, () => empty);
    } catch (_) {
      return empty;
    }
  }

  prepareTurnSnapshot(input = {}) {
    const principal = input.principal;
    const memoryMode = input.memoryMode || "local_only";
    const empty = {
      allItems: [], values: {}, items: [], episodes: [], revision: 0, policy: null,
    };
    if (!principal || principal.authenticated !== true || memoryMode !== "cloud_sync") {
      return empty;
    }
    try {
      if (typeof this.preferenceService.prepareTurnSnapshot === "function") {
        const prepared = this.preferenceService.prepareTurnSnapshot({
          principal,
          query: input.message || input.query,
          goal: input.goal || input.intentName,
          termId: input.termId || "",
          releaseVersion: input.releaseVersion || "",
          memoryLimit: resolveMemoryLimit(input),
          episodeLimit: input.episodeLimit || 3,
        });
        return chain(prepared, (resolved) => {
          try {
            return {
              allItems: resolved.allItems.map((item) => ({ ...item, value: item.normalizedValue })),
              values: { ...resolved.values },
              items: resolved.items.map((item) => ({ ...item, value: item.normalizedValue })),
              episodes: resolved.episodes,
              revision: resolved.revision || 0,
              policy: resolved.policy || null,
            };
          } catch (_) {
            return empty;
          }
        }, () => empty);
      }
      // load/retrieve 内部已吞错（永不 reject），直接串联即可。
      return chain(this.load(input), (loaded) => chain(this.retrieve(input), (retrieved) => ({
        allItems: loaded.items,
        values: loaded.values,
        items: retrieved.items,
        episodes: retrieved.episodes,
        revision: Math.max(loaded.revision || 0, retrieved.revision || 0),
        policy: loaded.policy,
      })));
    } catch (_) {
      return empty;
    }
  }

  /**
   * Commit durable candidates (+ optional Episode) under cloud_sync only.
   * session_state keeps thread/working only — no cross-conversation User Memory.
   *
   * M1：偏好/约束/Episode 归并为一个确定性 Mutation Plan，经
   * preferenceService.applyMutationPlan 一次权威 mutate 原子落盘（all-or-nothing）。
   * 首次携带本轮读取的 expectedRevision；冲突 → 重读最新 revision → 以最新状态
   * 为基线重算合并（服务层回调在最新 document 上重跑 supersede/去重/TTL/scope/
   * confidence/容量/Episode 合并）→ 仅重试一次；两次仍冲突则 fail-soft 跳过并
   * 产生 memory.write_skipped 结构化事件。Schema/权限/认证/存储错误准确分类，
   * 不伪装成 revision conflict、不盲目重试。
   */
  commit(input = {}) {
    const principal = input.principal;
    const memoryMode = input.memoryMode || "local_only";
    const autoMemoryEnabled = input.autoMemoryEnabled !== false;
    if (!principal || principal.authenticated !== true) {
      return { persisted: false, keys: [], items: [] };
    }
    if (memoryMode !== "cloud_sync") {
      return {
        persisted: false,
        keys: [],
        items: [],
        reason: memoryMode === "session_state" ? "session_state_no_user_memory" : "not_authorized",
        episode: input.episode ? { persisted: false, reason: "not_cloud_sync" } : undefined,
      };
    }

    // Low#5：pause/autoMemoryEnabled=false 只停自动抽取/implicit 写入；
    // explicit 候选（用户明确纠正/确认/手动编辑）不在此处拦截，由服务层豁免放行。
    const semanticValidation = validateMemoryCandidates(input.candidates || [], {
      message: input.message,
      memoryMode,
    });
    const filtered = filterAndMergeCandidates(semanticValidation.accepted, {
      memoryMode,
      autoMemoryEnabled,
      policy: input.policy || null,
    }).filter((c) => c.durable && isLowRiskKey(c.key));

    const values = {};
    filtered.forEach((candidate) => {
      if (!EXTENDED_KEYS.includes(candidate.key)) return;
      const normalized = normalizeValue(candidate.key, candidate.value);
      if (normalized !== null) values[candidate.key] = normalized;
    });

    const boundaryConflicts = [];
    const entries = filtered.filter((candidate) => (
      Object.prototype.hasOwnProperty.call(values, candidate.key)
    )).map((candidate) => {
      const boundary = resolveCanonicalBoundary(candidate, input);
      boundary.boundaryConflicts.forEach((code) => {
        if (!boundaryConflicts.includes(code)) boundaryConflicts.push(code);
      });
      const scope = candidate.scope === "term" || candidate.scope === "release"
        ? candidate.scope
        : (candidate.key === "preferredClassName" ? "release" : "user");
      return {
        explicit: candidate.source === "explicit_user",
        kind: candidate.key === "preferredName" ? "identity_alias"
          : candidate.key === "answerDetailLevel" ? "interaction_preference"
            : candidate.key === "preferredClassName" ? "task_constraint" : "stable_preference",
        key: candidate.key,
        content: `${candidate.key}=${String(values[candidate.key])}`,
        normalizedValue: values[candidate.key],
        provenance: {
          type: candidate.correction ? "user_correction" : (candidate.source === "explicit_user" ? "user_explicit" : "auto_extract"),
          turnId: candidate.sourceTurnIds && candidate.sourceTurnIds[0] || "",
          runId: input.runId || "",
          source: candidate.source || "",
          reasonCode: candidate.reasonCode || "",
          sourceSummary: candidate.sourceSummary || "",
        },
        confidence: candidate.confidence,
        scope,
        correction: candidate.correction,
        termId: boundary.termId,
        releaseVersion: boundary.releaseVersion,
        // 显式过期时间原样传递；策略默认 TTL 传 ttlMs，由服务层在落盘时刻计算，
        // revision 冲突重试时 TTL 随最新状态重算（M1/Low#4）。
        // P4b 审查跟进：ttlMs 必须带 policy——发布策略的 ttlOverridesMs 在写路径
        // 真实生效（此前丢弃 policy 导致落盘恒为静态 TTL）。
        ...(candidate.expiresAtSource === "explicit"
          ? { expiresAt: candidate.expiresAt }
          : { ttlMs: resolveTtlMs(Object.assign({}, candidate, { scope }), input.policy || null) }),
      };
    });

    const episodePlan = input.episode && typeof input.episode === "object" && input.episode.goal
      ? Object.assign({}, input.episode, {
        termId: input.termId || input.episode.termId || "",
        releaseVersion: input.releaseVersion || input.episode.releaseVersion || "",
      })
      : null;

    if (!entries.length && !episodePlan) {
      return {
        persisted: false,
        keys: [],
        items: [],
        semanticValidation: {
          acceptedCount: semanticValidation.accepted.length,
          rejectedCount: semanticValidation.rejected.length,
        },
      };
    }

    const mutationCategories = Array.from(new Set(
      entries.map((entry) => (entry.kind === "task_constraint" ? "constraint" : "preference"))
        .concat(episodePlan ? ["episode"] : [])
    ));
    const eventBase = {
      mutationCategories,
      mutationCount: entries.length + (episodePlan ? 1 : 0),
      runId: input.runId || "",
      conversationId: input.conversationId || "",
      policyVersion: input.policyVersion || "",
      boundaryConflicts,
    };

    // 兼容路径：服务缺少 applyMutationPlan 时退回既有逐条写入（不建第二套存储）。
    if (typeof this.preferenceService.applyMutationPlan !== "function") {
      return this.commitLegacy({
        principal,
        memoryMode,
        entries,
        episodePlan,
        verified: input.verified === true,
      });
    }

    const maxAttempts = 2;
    const state = {
      expectedRevision: input.expectedRevision === undefined || input.expectedRevision === null
        ? null
        : Number(input.expectedRevision),
      latestPolicyVersion: eventBase.policyVersion,
    };
    const firstExpectedRevision = state.expectedRevision;

    const succeed = (saved, attemptCount) => {
      try {
        const stored = (saved.items || []).map((item) => ({ ...item, value: item.normalizedValue }));
        emitMemoryWriteEvent(Object.assign({}, eventBase, {
          event: "memory.write_succeeded",
          reason: saved.reason || "",
          attemptCount,
          oldRevision: firstExpectedRevision,
          latestRevision: saved.revision,
          policyVersion: state.latestPolicyVersion || eventBase.policyVersion,
        }));
        return {
          persisted: saved.persisted === true,
          keys: Array.from(new Set(stored.map((item) => item.key))),
          items: stored,
          reason: saved.reason || "",
          revision: saved.revision || 0,
          episode: saved.episode || (episodePlan ? { persisted: false, reason: "" } : undefined),
          writeStatus: "succeeded",
          attemptCount,
          retried: attemptCount > 1,
          boundaryConflicts,
        };
      } catch (error) {
        return fail(error, attemptCount);
      }
    };

    const fail = (error, attemptCount) => {
      if (error && error.code === "MEMORY_REVISION_CONFLICT") {
        if (attemptCount >= maxAttempts) {
          // 两次仍冲突：fail-soft 跳过，不让聊天 Turn 失败、不产生技术 409。
          emitMemoryWriteEvent(Object.assign({}, eventBase, {
            event: "memory.write_skipped",
            reason: "revision_conflict_exhausted",
            attemptCount,
            oldRevision: firstExpectedRevision,
            latestRevision: state.expectedRevision,
            policyVersion: state.latestPolicyVersion || eventBase.policyVersion,
          }));
          return {
            persisted: false,
            keys: [],
            items: [],
            reason: "revision_conflict_exhausted",
            revision: 0,
            episode: episodePlan ? { persisted: false, reason: "revision_conflict_exhausted" } : undefined,
            writeStatus: "skipped",
            attemptCount,
            retried: true,
            boundaryConflicts,
          };
        }
        // 冲突 → 重读最新状态 → 以最新 revision 为基线仅重试一次。
        const onBaseline = (latest) => {
          const latestRevision = latest && Number(latest.revision);
          if (latest && latest.policyVersion) state.latestPolicyVersion = latest.policyVersion;
          if (!Number.isFinite(latestRevision)) {
            // 无法获得可信基线时不盲目无 revision 写入；准确分类为基线不可用。
            emitMemoryWriteEvent(Object.assign({}, eventBase, {
              event: "memory.write_failed",
              reason: "revision_baseline_unavailable",
              attemptCount,
              oldRevision: firstExpectedRevision,
              latestRevision: null,
              policyVersion: state.latestPolicyVersion || eventBase.policyVersion,
            }));
            return {
              persisted: false,
              keys: [],
              items: [],
              reason: "revision_baseline_unavailable",
              revision: 0,
              episode: episodePlan ? { persisted: false, reason: "revision_baseline_unavailable" } : undefined,
              writeStatus: "failed",
              attemptCount,
              retried: false,
              boundaryConflicts,
            };
          }
          emitMemoryWriteEvent(Object.assign({}, eventBase, {
            event: "memory.write_retried",
            reason: "revision_conflict",
            attemptCount: attemptCount + 1,
            oldRevision: state.expectedRevision,
            latestRevision,
            policyVersion: state.latestPolicyVersion || eventBase.policyVersion,
          }));
          state.expectedRevision = latestRevision;
          return attempt(attemptCount);
        };
        let latestRead = null;
        try {
          latestRead = typeof this.preferenceService.readRevision === "function"
            ? this.preferenceService.readRevision({ principal })
            : null;
        } catch (_) {
          latestRead = null;
        }
        return chain(latestRead, onBaseline, () => onBaseline(null));
      }
      const category = classifyMemoryWriteError(error);
      emitMemoryWriteEvent(Object.assign({}, eventBase, {
        event: "memory.write_failed",
        reason: category,
        attemptCount,
        oldRevision: firstExpectedRevision,
        latestRevision: state.expectedRevision,
        policyVersion: state.latestPolicyVersion || eventBase.policyVersion,
      }));
      return {
        persisted: false,
        keys: [],
        items: [],
        reason: category,
        revision: 0,
        episode: episodePlan ? { persisted: false, reason: category } : undefined,
        writeStatus: "failed",
        attemptCount,
        retried: attemptCount > 1,
        boundaryConflicts,
      };
    };

    const attempt = (previousAttemptCount) => {
      const attemptCount = (previousAttemptCount || 0) + 1;
      let saved;
      try {
        saved = this.preferenceService.applyMutationPlan({
          principal,
          memoryMode,
          entries,
          episode: episodePlan,
          verified: input.verified === true,
          expectedRevision: state.expectedRevision,
        });
      } catch (error) {
        return fail(error, attemptCount);
      }
      return chain(saved, (resolved) => succeed(resolved, attemptCount), (error) => fail(error, attemptCount));
    };

    return attempt(0);
  }

  /**
   * 兼容路径：旧服务实例无 applyMutationPlan 时使用（既有 upsertMemoryBatch /
   * upsertMemory + appendEpisode），保持 Low#5 explicit 豁免去服务层判定。
   */
  commitLegacy({ principal, memoryMode, entries, episodePlan, verified }) {
    const failed = { persisted: false, keys: [], items: [] };
    const finishWith = (saved, stored) => {
      const finishEpisode = (episode) => ({
        persisted: saved.persisted === true,
        keys: Array.from(new Set(stored.map((item) => item.key))),
        items: stored,
        reason: saved.reason || "",
        revision: saved.revision || 0,
        episode,
        writeStatus: "succeeded",
        attemptCount: 1,
      });
      let episodeResult;
      try {
        episodeResult = episodePlan && typeof this.preferenceService.appendEpisode === "function"
          ? this.preferenceService.appendEpisode({
            principal,
            memoryMode,
            verified,
            episode: episodePlan,
          })
          : (episodePlan ? { persisted: false, reason: "episode_store_unavailable" } : undefined);
      } catch (_) {
        return failed;
      }
      return chain(episodeResult, finishEpisode, () => failed);
    };
    try {
      if (typeof this.preferenceService.upsertMemoryBatch === "function") {
        const saved = this.preferenceService.upsertMemoryBatch({ principal, memoryMode, entries });
        return chain(saved, (resolved) => {
          try {
            const stored = (resolved.items || []).map((item) => ({ ...item, value: item.normalizedValue }));
            return finishWith(resolved, stored);
          } catch (_) {
            return failed;
          }
        }, () => failed);
      }
      const stored = [];
      const runEntries = (index) => {
        if (index >= entries.length || typeof this.preferenceService.upsertMemory !== "function") {
          const saved = stored.length ? { persisted: true, reason: "" } : { persisted: false, reason: "" };
          return finishWith(saved, stored);
        }
        let result;
        try {
          result = this.preferenceService.upsertMemory({
            principal,
            memoryMode,
            explicit: entries[index].explicit,
            entry: entries[index],
          });
        } catch (_) {
          return failed;
        }
        return chain(result, (resolved) => {
          try {
            if (resolved.persisted && resolved.memory) stored.push({ ...resolved.memory, value: resolved.memory.normalizedValue });
          } catch (_) {
            return failed;
          }
          return runEntries(index + 1);
        }, () => failed);
      };
      return runEntries(0);
    } catch (_) {
      return failed;
    }
  }

  list(input = {}) {
    return this.load(input);
  }

  retrieve(input = {}) {
    const empty = { items: [], episodes: [], revision: 0 };
    if (!input.principal || input.memoryMode !== "cloud_sync") return empty;
    try {
      const memories = this.preferenceService.retrieveMemories({
        principal: input.principal,
        query: input.message || input.query,
        goal: input.goal || input.intentName,
        termId: input.termId || "",
        releaseVersion: input.releaseVersion || "",
        limit: resolveMemoryLimit(input),
      });
      return chain(memories, (memoriesResolved) => {
        let episodes;
        try {
          episodes = this.preferenceService.retrieveEpisodes({
            principal: input.principal,
            query: input.message || input.query,
            goal: input.goal || input.intentName,
            termId: input.termId || "",
            releaseVersion: input.releaseVersion || "",
            limit: input.episodeLimit || 3,
          });
        } catch (_) {
          return empty;
        }
        return chain(episodes, (episodesResolved) => {
          try {
            return {
              items: memoriesResolved.items.map((item) => ({ ...item, value: item.normalizedValue })),
              episodes: episodesResolved.items,
              revision: Math.max(memoriesResolved.revision || 0, episodesResolved.revision || 0),
            };
          } catch (_) {
            return empty;
          }
        }, () => empty);
      }, () => empty);
    } catch (_) {
      return empty;
    }
  }

  invalidateContext(input = {}) {
    const empty = { invalidatedIds: [], revision: 0 };
    if (!input.principal || input.memoryMode !== "cloud_sync") return empty;
    try {
      return chain(this.preferenceService.invalidateContext({
        principal: input.principal,
        termId: input.termId,
        releaseVersion: input.releaseVersion,
        expectedRevision: input.expectedRevision,
      }), (result) => result, () => empty);
    } catch (_) {
      return empty;
    }
  }

  appendEpisode(input = {}) {
    const empty = { persisted: false, reason: "episode_store_failed" };
    if (!input.principal || input.memoryMode !== "cloud_sync") return { persisted: false, reason: "not_cloud_sync" };
    try {
      return chain(this.preferenceService.appendEpisode(input), (result) => result, () => empty);
    } catch (_) {
      return empty;
    }
  }

  remove(input = {}) {
    const empty = { deleted: false };
    if (!input.principal || !input.key) return empty;
    try {
      return chain(this.preferenceService.remove({
        principal: input.principal,
        key: input.key,
        expectedRevision: input.expectedRevision,
      }), (result) => result, () => empty);
    } catch (_) {
      return empty;
    }
  }

  clear(input = {}) {
    const empty = { deleted: 0 };
    if (!input.principal) return empty;
    try {
      return chain(this.preferenceService.clear({
        principal: input.principal,
        expectedRevision: input.expectedRevision,
      }), (result) => result, () => empty);
    } catch (_) {
      return empty;
    }
  }
}

const defaultUserMemoryStore = new UserMemoryStore();

module.exports = {
  EXTENDED_KEYS,
  UserMemoryStore,
  defaultUserMemoryStore,
  toMemoryItems,
  classifyMemoryWriteError,
  resolveCanonicalBoundary,
  listMemoryWriteEventsForTest,
  clearMemoryWriteEventsForTest,
};
