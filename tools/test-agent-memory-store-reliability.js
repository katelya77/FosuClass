#!/usr/bin/env node
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { UserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptLegacy(values, secret, principalKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(principalKey));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(values), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function memoryInput(principal, key, value, extra = {}) {
  return {
    principal,
    memoryMode: "cloud_sync",
    explicit: extra.explicit !== false,
    expectedRevision: extra.expectedRevision,
    entry: {
      kind: extra.kind || "stable_preference",
      key,
      content: extra.content || `${key}=${String(value)}`,
      normalizedValue: value,
      provenance: extra.provenance || { type: extra.explicit === false ? "auto_extract" : "user_explicit" },
      confidence: extra.confidence === undefined ? 0.98 : extra.confidence,
      scope: extra.scope || "user",
      termId: extra.termId || "",
      releaseVersion: extra.releaseVersion || "",
      correction: extra.correction === true,
      confirmation: extra.confirmation === true,
      ttlMs: extra.ttlMs,
    },
  };
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaofu-memory-store-reliability-"));
  const secret = "memory-store-reliability-secret";
  let now = Date.parse("2026-07-30T08:00:00.000Z");
  const clock = { now: () => now };
  const createService = () => new UserPreferenceService({ dataDir: root, secret, clock });
  const principal = { authenticated: true, principalKey: "memory-reliability-owner" };
  const fileFor = (owner) => createService().filePath(owner.principalKey);

  try {
    const service = createService();

    const first = service.upsertMemory(memoryInput(principal, "preferredBuilding", "C7"));
    assert.strictEqual(first.persisted, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(fileFor(principal), "utf8")).schemaVersion, "user-memory.v2");

    const duplicate = service.upsertMemory(memoryInput(principal, "preferredBuilding", "C7", {
      expectedRevision: first.revision,
    }));
    assert.strictEqual(duplicate.persisted, false, "same value must be deduplicated");
    assert.strictEqual(duplicate.reason, "MEMORY_DEDUPLICATED");
    assert.strictEqual(duplicate.revision, first.revision, "dedupe must not create a revision");

    const lowerConfidenceAuto = service.upsertMemory(memoryInput(principal, "preferredBuilding", "D2", {
      explicit: false,
      confidence: 0.75,
      expectedRevision: first.revision,
    }));
    assert.strictEqual(lowerConfidenceAuto.persisted, false);
    assert.strictEqual(lowerConfidenceAuto.reason, "MEMORY_CONFLICT_LOWER_CONFIDENCE");
    assert.strictEqual(service.getObject({ principal }).preferredBuilding, "C7");

    const confirmationOwner = { authenticated: true, principalKey: "memory-confirmation-owner" };
    const confirmationFirst = service.upsertMemory(memoryInput(confirmationOwner, "preferredBuilding", "E3", {
      ttlMs: 5 * 60 * 1000,
    }));
    now += 2 * 60 * 1000;
    const confirmed = service.upsertMemory(memoryInput(confirmationOwner, "preferredBuilding", "E3", {
      confirmation: true,
      expectedRevision: confirmationFirst.revision,
      ttlMs: 5 * 60 * 1000,
      provenance: { type: "user_confirmation" },
    }));
    assert.strictEqual(confirmed.persisted, true);
    assert.strictEqual(confirmed.reason, "MEMORY_CONFIRMED");
    assert.strictEqual(confirmed.memory.memoryId, confirmationFirst.memory.memoryId);
    assert.ok(Date.parse(confirmed.memory.expiresAt) > Date.parse(confirmationFirst.memory.expiresAt));

    const correction = service.upsertMemory(memoryInput(principal, "preferredBuilding", "D2", {
      correction: true,
      confidence: 1,
      expectedRevision: first.revision,
      provenance: { type: "user_correction" },
    }));
    assert.strictEqual(correction.persisted, true);
    assert.strictEqual(correction.memory.supersedes, first.memory.memoryId);

    const irrelevant = service.retrieveMemories({
      principal,
      query: "recommend dinner and a movie",
      goal: "meal_planning",
      limit: 5,
    });
    assert.deepStrictEqual(irrelevant.items, [], "confidence/recency alone must not inject unrelated memory");
    const relevant = service.retrieveMemories({
      principal,
      query: "find my usual study building",
      goal: "find_empty_room",
      limit: 5,
    });
    assert.strictEqual(relevant.items[0].memoryId, correction.memory.memoryId);

    const scoped = service.upsertMemory(memoryInput(principal, "preferredClassName", "25测试6班", {
      kind: "task_constraint",
      scope: "release",
      termId: "2025-2026-2",
      releaseVersion: "release-1",
      expectedRevision: correction.revision,
    }));
    assert.strictEqual(service.retrieveMemories({
      principal,
      query: "查我的目标班级课表",
      goal: "schedule_lookup",
      termId: "2025-2026-2",
      releaseVersion: "release-1",
    }).items.some((item) => item.memoryId === scoped.memory.memoryId), true);
    assert.strictEqual(service.retrieveMemories({
      principal,
      query: "查我的目标班级课表",
      goal: "schedule_lookup",
      termId: "2026-2027-1",
      releaseVersion: "release-2",
    }).items.some((item) => item.memoryId === scoped.memory.memoryId), false);
    assert.strictEqual(service.retrieveMemories({
      principal,
      query: "查我的目标班级课表",
      goal: "schedule_lookup",
    }).items.some((item) => item.memoryId === scoped.memory.memoryId), false, "versioned memory needs an authoritative current boundary");
    const unscopedTurn = service.prepareTurnSnapshot({
      principal,
      query: "check my target class schedule",
      goal: "schedule_lookup",
    });
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(unscopedTurn.values, "preferredClassName"),
      false,
      "turn snapshots must not project release-scoped values without the authoritative boundary"
    );

    const beforeNoop = fs.readFileSync(fileFor(principal), "utf8");
    const noInvalidation = service.invalidateContext({
      principal,
      expectedRevision: scoped.revision,
      termId: "2025-2026-2",
      releaseVersion: "release-1",
    });
    assert.deepStrictEqual(noInvalidation.invalidatedIds, []);
    assert.strictEqual(noInvalidation.revision, scoped.revision);
    assert.strictEqual(fs.readFileSync(fileFor(principal), "utf8"), beforeNoop, "no-op invalidation must not write");

    const unverifiedEpisode = service.appendEpisode({
      principal,
      memoryMode: "cloud_sync",
      expectedRevision: scoped.revision,
      episode: {
        goal: "find_empty_room",
        outcomeSummary: "found a room",
        provenanceRunId: "run-unverified",
        status: "success",
      },
    });
    assert.strictEqual(unverifiedEpisode.persisted, false);
    assert.strictEqual(unverifiedEpisode.reason, "EPISODE_NOT_VERIFIED");

    const verifiedEpisode = service.appendEpisode({
      principal,
      memoryMode: "cloud_sync",
      expectedRevision: scoped.revision,
      verified: true,
      episode: {
        goal: "find_empty_room",
        outcomeSummary: "found a room",
        provenanceRunId: "run-verified",
        status: "success",
      },
    });
    assert.strictEqual(verifiedEpisode.persisted, true);
    const listedEpisodes = service.listEpisodes({ principal, page: 1, pageSize: 10 });
    assert.strictEqual(listedEpisodes.items[0].episodeId, verifiedEpisode.episode.episodeId);
    assert.ok(!JSON.stringify(listedEpisodes).includes("featureVector"));
    // Low#2：deleteEpisode 与 deleteMemory 统一 404 语义，未找到即抛出。
    assert.throws(() => service.deleteEpisode({
      principal,
      episodeId: "episode_missing",
      expectedRevision: verifiedEpisode.revision,
    }), (error) => error && error.code === "EPISODE_NOT_FOUND" && error.statusCode === 404);
    assert.throws(() => service.deleteMemory({
      principal,
      memoryId: "mem_missing",
      expectedRevision: verifiedEpisode.revision,
    }), (error) => error && error.code === "MEMORY_NOT_FOUND" && error.statusCode === 404);
    assert.strictEqual(service.listEpisodes({ principal }).revision, verifiedEpisode.revision, "404 must not create a revision");

    const managementSnapshot = service.getManagementSnapshot({ principal, includeInactive: true });
    assert.strictEqual(managementSnapshot.revision, verifiedEpisode.revision);
    assert.ok(Array.isArray(managementSnapshot.items));
    assert.ok(Array.isArray(managementSnapshot.episodes));
    assert.ok(!JSON.stringify(managementSnapshot).includes("featureVector"));

    const batchOwner = { authenticated: true, principalKey: "memory-batch-owner" };
    const batch = service.upsertMemoryBatch({
      principal: batchOwner,
      memoryMode: "cloud_sync",
      expectedRevision: 0,
      entries: [
        memoryInput(batchOwner, "preferredBuilding", "C8").entry,
        memoryInput(batchOwner, "answerDetailLevel", "detailed").entry,
      ],
    });
    assert.strictEqual(batch.persisted, true);
    assert.strictEqual(batch.revision, 1, "a multi-memory turn must commit as one revision");
    assert.strictEqual(batch.items.length, 2);
    const turnSnapshot = service.prepareTurnSnapshot({
      principal: batchOwner,
      query: "use my usual study building and detailed answer preference",
      goal: "general_assistant",
      memoryLimit: 5,
      episodeLimit: 3,
    });
    assert.strictEqual(turnSnapshot.revision, batch.revision);
    assert.strictEqual(turnSnapshot.values.preferredBuilding, "C8");
    assert.strictEqual(turnSnapshot.values.answerDetailLevel, "detailed");
    assert.strictEqual(turnSnapshot.items.length, 2);
    assert.ok(!JSON.stringify(turnSnapshot).includes("featureVector"));

    const deleteEpisodeOwner = { authenticated: true, principalKey: "memory-delete-episode-owner" };
    const deletableEpisode = service.appendEpisode({
      principal: deleteEpisodeOwner,
      memoryMode: "cloud_sync",
      verified: true,
      episode: {
        goal: "schedule_lookup",
        outcomeSummary: "verified schedule lookup",
        provenanceRunId: "run-delete-episode",
        status: "success",
      },
    });
    const deletedEpisode = service.deleteEpisode({
      principal: deleteEpisodeOwner,
      episodeId: deletableEpisode.episode.episodeId,
      expectedRevision: deletableEpisode.revision,
    });
    assert.strictEqual(deletedEpisode.deleted, true);
    assert.strictEqual(service.listEpisodes({ principal: deleteEpisodeOwner }).total, 0);

    const paused = service.setMemoryPolicy({
      principal,
      expectedRevision: verifiedEpisode.revision,
      patch: { paused: true, autoMemoryEnabled: false, capacity: 1, episodeCapacity: 1 },
    });
    assert.strictEqual(service.listMemoryItems({ principal }).items.length, 1, "policy capacity applies immediately");
    const deniedEpisode = service.appendEpisode({
      principal,
      memoryMode: "cloud_sync",
      expectedRevision: paused.revision,
      verified: true,
      episode: {
        goal: "find_empty_room",
        outcomeSummary: "another result",
        provenanceRunId: "run-paused",
        status: "success",
      },
    });
    assert.strictEqual(deniedEpisode.persisted, false);
    assert.strictEqual(deniedEpisode.reason, "MEMORY_PAUSED");
    assert.strictEqual(deniedEpisode.revision, paused.revision);

    const historyOwner = { authenticated: true, principalKey: "memory-history-cap-owner" };
    let historyRevision = 0;
    for (let index = 0; index < 20; index += 1) {
      const stored = service.upsertMemory(memoryInput(historyOwner, "preferredBuilding", `B${index}`, {
        correction: index > 0,
        expectedRevision: historyRevision,
        provenance: { type: index ? "user_correction" : "user_explicit" },
      }));
      historyRevision = stored.revision;
    }
    const cappedHistory = service.setMemoryPolicy({
      principal: historyOwner,
      expectedRevision: historyRevision,
      patch: { capacity: 1 },
    });
    const historicalItems = service.listMemoryItems({
      principal: historyOwner,
      includeInactive: true,
      pageSize: 100,
    });
    assert.strictEqual(service.listMemoryItems({ principal: historyOwner }).items.length, 1);
    assert.ok(historicalItems.total <= 11, "inactive superseded history must remain bounded");
    assert.strictEqual(historicalItems.revision, cappedHistory.revision);

    const exported = service.exportMemories({ principal });
    assert.strictEqual(exported.revision, paused.revision);
    assert.ok(!JSON.stringify(exported).includes("featureVector"));
    assert.ok(Array.isArray(exported.audit));

    const ttlOwner = { authenticated: true, principalKey: "memory-ttl-owner" };
    const ttlWrite = service.upsertMemory(memoryInput(ttlOwner, "preferredBuilding", "A1", { ttlMs: 5 * 60 * 1000 }));
    const ttlRevision = ttlWrite.revision;
    now += 6 * 60 * 1000;
    assert.deepStrictEqual(service.retrieveMemories({
      principal: ttlOwner,
      query: "usual study building",
      goal: "find_empty_room",
    }).items, []);
    assert.strictEqual(service.listMemoryItems({ principal: ttlOwner }).revision, ttlRevision, "TTL expiry on read must not mutate revision");

    const expiryCapacityOwner = { authenticated: true, principalKey: "memory-expiry-capacity-owner" };
    const expiringHighConfidence = service.upsertMemory(memoryInput(
      expiryCapacityOwner,
      "preferredBuilding",
      "A9",
      { ttlMs: 5 * 60 * 1000, confidence: 1 }
    ));
    const expiryCapacityPolicy = service.setMemoryPolicy({
      principal: expiryCapacityOwner,
      expectedRevision: expiringHighConfidence.revision,
      patch: { capacity: 1 },
    });
    now += 6 * 60 * 1000;
    const validAfterExpiry = service.upsertMemory(memoryInput(
      expiryCapacityOwner,
      "answerDetailLevel",
      "detailed",
      { expectedRevision: expiryCapacityPolicy.revision, confidence: 0.7 }
    ));
    assert.strictEqual(validAfterExpiry.persisted, true);
    assert.deepStrictEqual(
      service.listMemoryItems({ principal: expiryCapacityOwner }).items.map((item) => item.key),
      ["answerDetailLevel"],
      "expired high-confidence records must not evict a fresh active memory"
    );

    const legacyOwner = { authenticated: true, principalKey: "memory-legacy-owner" };
    const legacyUpdatedAt = "2026-07-01T00:00:00.000Z";
    fs.mkdirSync(path.dirname(fileFor(legacyOwner)), { recursive: true });
    fs.writeFileSync(fileFor(legacyOwner), JSON.stringify({
      schemaVersion: "user-preferences.v1",
      updatedAt: legacyUpdatedAt,
      encrypted: encryptLegacy({ preferredBuilding: "B8" }, secret, legacyOwner.principalKey),
    }), "utf8");
    const legacyFirst = service.listMemoryItems({ principal: legacyOwner, includeInactive: true });
    const expectedLegacyExpiry = new Date(Date.parse(legacyUpdatedAt) + 90 * 86400000).toISOString();
    assert.strictEqual(legacyFirst.items[0].expiresAt, expectedLegacyExpiry);
    now += 24 * 60 * 60 * 1000;
    const legacyAgain = service.listMemoryItems({ principal: legacyOwner, includeInactive: true });
    assert.strictEqual(legacyAgain.items[0].expiresAt, expectedLegacyExpiry, "legacy reads must not renew TTL");

    // Low#4：TTL 类别化 —— 空串/非法日期/缺失 expiresAt ≠ 永久有效。
    const memoryPolicy = require("../server/src/services/ai/memory/memoryPolicy");
    assert.strictEqual(memoryPolicy.isExpired({ key: "campus", expiresAt: "" }, now), true, "empty expiresAt must fail closed");
    assert.strictEqual(memoryPolicy.isExpired({ key: "campus", expiresAt: "not-a-date" }, now), true, "invalid date without timestamps must fail closed");
    assert.strictEqual(
      memoryPolicy.isExpired({ key: "campus", expiresAt: "not-a-date", updatedAt: new Date(now - 86400000).toISOString() }, now),
      false,
      "invalid expiresAt falls back to updatedAt + category TTL"
    );
    assert.strictEqual(
      memoryPolicy.isExpired({ key: "campus", expiresAt: "", updatedAt: new Date(now - 100 * 86400000).toISOString() }, now),
      true,
      "legacy fallback must not resurrect data older than category TTL"
    );
    assert.strictEqual(
      memoryPolicy.effectiveExpiryMs({ key: "campus", expiresAt: "", createdAt: new Date(now - 10 * 86400000).toISOString() }),
      now - 10 * 86400000 + 90 * 86400000,
      "createdAt is the last-resort base for legacy TTL"
    );
    // scope=term/release：短 TTL 且绑版本边界。
    const scopedCandidate = memoryPolicy.filterAndMergeCandidates([{
      key: "preferredClassName",
      value: "25时限3班",
      scope: "release",
      confidence: 0.95,
      source: "explicit_user",
    }], { memoryMode: "cloud_sync", autoMemoryEnabled: true })[0];
    assert.ok(scopedCandidate.expiresAtSource === "policy");
    assert.ok(
      Date.parse(scopedCandidate.expiresAt) <= now + 30 * 86400000 + 1000,
      "term/release-scoped memory must use the short version-bound TTL"
    );

    // 存储层 fail-closed：手工 v2 文档中缺 expiresAt/时间戳的条目不得进入列表与值投影。
    const failClosedOwner = { authenticated: true, principalKey: "memory-ttl-failclosed-owner" };
    const ttlBase = now;
    const toTz = (ms, offsetHours) => {
      const shifted = new Date(ms + offsetHours * 3600000);
      const sign = offsetHours < 0 ? "-" : "+";
      return `${shifted.toISOString().slice(0, 19)}${sign}${String(Math.abs(offsetHours)).padStart(2, "0")}:00`;
    };
    const v2Item = (memoryId, key, normalizedValue, extra = {}) => ({
      memoryId,
      kind: "stable_preference",
      key,
      content: `${key}=${String(normalizedValue)}`,
      normalizedValue,
      provenance: { type: "legacy_migration", recordedAt: extra.recordedAt || "" },
      confidence: 0.9,
      scope: "user",
      expiresAt: extra.expiresAt === undefined ? "" : extra.expiresAt,
      supersedes: "",
      supersededBy: "",
      status: "active",
      termId: "",
      releaseVersion: "",
      revision: 1,
      createdAt: extra.createdAt || "",
      updatedAt: extra.updatedAt || "",
      featureVector: [],
    });
    const v2Document = {
      revision: 1,
      policy: {
        mode: "cloud_sync",
        autoMemoryEnabled: true,
        paused: false,
        capacity: 50,
        episodeCapacity: 30,
        configVersion: "memory-default-v1",
        updatedAt: new Date(ttlBase).toISOString(),
      },
      items: [
        // 非法 expiresAt + 100 天前 updatedAt → legacy 起算后仍过期。
        v2Item("mem_ttl_expired", "preferredBuilding", "F1", {
          expiresAt: "not-a-date",
          updatedAt: new Date(ttlBase - 100 * 86400000).toISOString(),
        }),
        // 空 expiresAt + 80 天前 updatedAt → legacy 起算仍有效。
        v2Item("mem_ttl_legacy_live", "campus", "仙溪校区", {
          updatedAt: new Date(ttlBase - 80 * 86400000).toISOString(),
        }),
        // 非法 expiresAt + 近期 updatedAt → 回退有效。
        v2Item("mem_ttl_invalid_date", "preferredName", "时限同学", {
          expiresAt: "2026-13-45T99:99:99",
          updatedAt: new Date(ttlBase - 3600000).toISOString(),
        }),
        // 缺 expiresAt 且无任何时间戳 → fail closed。
        v2Item("mem_ttl_unknown", "answerDetailLevel", "detailed"),
        // 时区偏移的过去时刻 → 过期。
        v2Item("mem_ttl_tz_past", "grade", "大二", {
          expiresAt: toTz(ttlBase - 60000, 8),
        }),
        // 时区偏移的未来时刻 → 有效。
        v2Item("mem_ttl_tz_future", "major", "动物医学", {
          expiresAt: toTz(ttlBase + 86400000, -5),
        }),
      ],
      episodes: [],
      audit: [],
    };
    fs.mkdirSync(path.dirname(fileFor(failClosedOwner)), { recursive: true });
    fs.writeFileSync(fileFor(failClosedOwner), JSON.stringify({
      schemaVersion: "user-memory.v2",
      revision: 1,
      updatedAt: new Date(ttlBase).toISOString(),
      encrypted: encryptLegacy(v2Document, secret, failClosedOwner.principalKey),
    }), "utf8");
    const failClosedList = service.listMemoryItems({ principal: failClosedOwner });
    assert.deepStrictEqual(
      failClosedList.items.map((item) => item.memoryId).sort(),
      ["mem_ttl_invalid_date", "mem_ttl_legacy_live", "mem_ttl_tz_future"].sort(),
      "only verifiably-valid memories may be listed"
    );
    const failClosedValues = service.getObject({ principal: failClosedOwner });
    assert.deepStrictEqual(Object.keys(failClosedValues).sort(), ["campus", "major", "preferredName"].sort());
    const failClosedSnapshot = service.prepareTurnSnapshot({ principal: failClosedOwner });
    assert.strictEqual(failClosedSnapshot.values.answerDetailLevel, undefined, "unverifiable memory must not enter a turn snapshot");
    assert.strictEqual(failClosedSnapshot.values.grade, undefined, "timezone-past memory must be expired");

    [
      ["unknown", { schemaVersion: "user-memory.v99", sentinel: "keep-unknown" }],
      ["corrupt", { schemaVersion: "user-memory.v2", revision: 9, encrypted: { algorithm: "aes-256-gcm", ciphertext: "bad" }, sentinel: "keep-corrupt" }],
    ].forEach(([name, raw]) => {
      const owner = { authenticated: true, principalKey: `memory-${name}-owner` };
      fs.mkdirSync(path.dirname(fileFor(owner)), { recursive: true });
      const original = JSON.stringify(raw);
      fs.writeFileSync(fileFor(owner), original, "utf8");
      assert.throws(() => service.upsertMemory(memoryInput(owner, "preferredBuilding", "C3")), (error) => (
        error && ["MEMORY_SCHEMA_UNSUPPORTED", "MEMORY_DOCUMENT_CORRUPT"].includes(error.code)
      ));
      assert.strictEqual(fs.readFileSync(fileFor(owner), "utf8"), original, `${name} data must never be overwritten`);
    });

    assert.throws(() => service.clear({ principal, expectedRevision: 0 }), (error) => error && error.code === "MEMORY_REVISION_CONFLICT");
    const cleared = service.clear({ principal, expectedRevision: paused.revision });
    assert.ok(cleared.deleted > 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(fileFor(principal), "utf8")).schemaVersion, "user-memory.v2", "clear keeps an audited v2 tombstone");
    const afterClear = service.exportMemories({ principal });
    assert.deepStrictEqual(afterClear.items, []);
    assert.deepStrictEqual(afterClear.episodes, []);
    assert.ok(afterClear.audit.some((entry) => entry.action === "clear"));

    const noSecret = new UserPreferenceService({ dataDir: root, secret: "", clock });
    assert.throws(() => noSecret.clear({ principal }), (error) => error && error.code === "MEMORY_SECRET_UNAVAILABLE");

    console.log("test-agent-memory-store-reliability: PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error("test-agent-memory-store-reliability: FAIL");
  console.error(error && error.stack || error);
  process.exit(1);
}
