/**
 * Unified Memory Controller — single authoritative load/commit path.
 * Wraps ConversationMemoryService + Working/Thread/User memory.
 */

const { defaultMemoryService } = require("../conversation/conversationMemoryService");
const { defaultUserMemoryStore } = require("./userMemory");
const { emptyWorkingMemory, normalizeWorkingMemory, updateWorkingMemory, workingMemoryToSlots } = require("./workingMemory");
const {
  buildSemanticSummary,
  mergeRecentTurns,
  turnsToRecentMessages,
  desensitizeTurns,
  sanitizeDurableTurnText,
} = require("./threadMemory");
const { extractMemoryCandidates } = require("./memoryCandidateExtractor");
const { filterAndMergeCandidates } = require("./memoryPolicy");
const { validateMemoryCandidates, isInvalidPreferredName } = require("./memorySemanticValidator");
const safetyGuard = require("../safetyGuard");

// maybe-async 透传（P5a WS6）：file 后端同步返回原值；postgres 后端返回 Promise。
function isThenable(value) {
  return Boolean(value) && typeof value.then === "function";
}

function chain(value, onFulfilled, onRejected) {
  if (!isThenable(value)) return onFulfilled(value);
  return value.then(onFulfilled, onRejected);
}

function hasMeaningfulSlotValue(value) {
  if (value === undefined || value === null || value === "") return false;
  if (value === 0 || value === "0") return false;
  if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;
  return true;
}

function mergeSeedSlots(clientSlots, serverSlots) {
  const merged = Object.assign({}, clientSlots && typeof clientSlots === "object" ? clientSlots : {});
  Object.entries(serverSlots && typeof serverSlots === "object" ? serverSlots : {}).forEach(([key, value]) => {
    if (hasMeaningfulSlotValue(value)) merged[key] = value;
  });
  return merged;
}

// 允许通过 ActionReceipt 提交记忆变更的命令白名单（与 routes/ai.js action-receipts 端点一致）：
// setCurrentSchedule + manifest 已定义的提醒类命令 createCourseReminder/deleteReminder。
// 白名单扩大不等于校验放松：pendingAction 的 command/runId/expiresAt/target 绑定对全部命令同样生效。
const RECEIPT_COMMANDS = ["setCurrentSchedule", "createCourseReminder", "deleteReminder"];
const REMINDER_RECEIPT_COMMANDS = ["createCourseReminder", "deleteReminder"];

class MemoryController {
  constructor(options = {}) {
    this.conversationMemory = options.conversationMemory || defaultMemoryService;
    this.userMemory = options.userMemory || defaultUserMemoryStore;
  }

  /**
   * Load thread + working + relevant user memories for a chat turn.
   * Returns unified conversationState field names for Kernel/Planner.
   */
  load(input = {}) {
    return chain(this.conversationMemory.loadForChat(input), (bundle) => this._loadWithBundle(input, bundle));
  }

  _loadWithBundle(input, bundle) {
    const memoryMode = bundle.memory && bundle.memory.mode || "local_only";
    const state = bundle.state;
    const context = Object.assign({}, bundle.context || input.context || {});

    const workingMemory = normalizeWorkingMemory(
      state && state.workingMemory
      || context.workingMemory
      || emptyWorkingMemory()
    );

    // Soft-fill working memory from persisted slots when empty.
    // A newly upserted server conversation carries a canonical but empty
    // contextSlots object. Do not let those empty sentinels erase confirmed,
    // already-sanitized slots from the current client request. Persisted
    // non-empty server values still win for follow-up inheritance.
    const slots = mergeSeedSlots(
      context.conversationSlots || context.contextSlots || {},
      state && state.contextSlots || {}
    );
    const allowCurrentTurnSemantics = input.executionPolicy !== "strict_model_first";
    const seeded = updateWorkingMemory(workingMemory, {
      // In strict_model_first the Provider owns the first semantic Decision.
      // Current-turn regex extraction is deferred until the post-Decision
      // commit; persisted slots and prior Working State remain available.
      message: allowCurrentTurnSemantics ? input.message : "",
      intentName: slots.lastIntent,
      contextSlots: slots,
      campus: context.campus || slots.campus,
      preferredName: workingMemory.preferredName
        || context.userPreferences && context.userPreferences.preferredName
        || "",
      pendingClarification: context.pendingClarification || (state && state.pendingClarification),
    });

    const authoritativeRelease = input.releaseContext && typeof input.releaseContext === "object"
      ? input.releaseContext
      : {};
    const versionBoundary = {
      termId: authoritativeRelease.term || authoritativeRelease.semester || "",
      releaseVersion: authoritativeRelease.releaseVersion || authoritativeRelease.version || "",
    };
    const afterInvalidate = () => {
      const preparedMemoryMaybe = typeof this.userMemory.prepareTurnSnapshot === "function"
        ? this.userMemory.prepareTurnSnapshot({
          principal: bundle.principal,
          memoryMode,
          message: input.message,
          workingMemory: seeded,
          goal: seeded.currentGoal,
          intentName: slots.lastIntent,
          ...versionBoundary,
          episodeLimit: 3,
          policy: input.policy || null,
        })
        : null;
      return chain(preparedMemoryMaybe, (preparedMemory) => {
        const userLoadedMaybe = preparedMemory
          ? {
            items: preparedMemory.allItems,
            values: preparedMemory.values,
            revision: preparedMemory.revision,
            policy: preparedMemory.policy,
          }
          : this.userMemory.load({
            principal: bundle.principal,
            memoryMode,
            policy: input.policy || null,
          });
        return chain(userLoadedMaybe, (userLoaded) => {
          if (userLoaded.values && userLoaded.values.preferredName && !seeded.preferredName) {
            seeded.preferredName = userLoaded.values.preferredName;
          }
          if (userLoaded.values && userLoaded.values.campus && !seeded.campus) {
            seeded.campus = userLoaded.values.campus;
          }
          ["college", "major", "grade"].forEach((key) => {
            if (userLoaded.values && userLoaded.values[key] && !seeded[key]) {
              seeded[key] = userLoaded.values[key];
            }
          });

          // session_state + cloud_sync both expose recent turns when present.
          const serverTurns = state && Array.isArray(state.recentTurns) ? state.recentTurns : [];
          let recentMessages = Array.isArray(context.recentMessages) ? context.recentMessages : [];
          if (serverTurns.length && memoryMode !== "local_only") {
            const fromServer = turnsToRecentMessages(serverTurns);
            const merged = [];
            const seenTurnIds = new Set();
            recentMessages.concat(fromServer).forEach((turn) => {
              const role = turn && turn.role === "user" ? "user" : "assistant";
              const content = safetyGuard.redactSensitiveText(String(turn && (turn.content || turn.text) || "")).slice(0, 400);
              if (!content) return;
              const turnId = String(turn.turnId || "").slice(0, 64);
              if (turnId && seenTurnIds.has(turnId)) return;
              if (turnId) seenTurnIds.add(turnId);
              const prev = merged[merged.length - 1];
              if (!turnId && prev && prev.role === role && prev.content === content) return;
              merged.push({ role, content, turnId: turnId || undefined });
            });
            recentMessages = merged.slice(-12);
          }

          // User preferences only when cloud_sync loaded them.
          if (memoryMode === "cloud_sync" && userLoaded.values && Object.keys(userLoaded.values).length) {
            context.userPreferences = Object.assign({}, context.userPreferences || {}, userLoaded.values, {
              localOnly: false,
            });
          }

          const conversationSummary = (state && state.conversationSummary)
            || context.conversationSummary
            || "";

          const retrievedMaybe = preparedMemory
            ? {
              items: preparedMemory.items,
              episodes: preparedMemory.episodes,
              revision: preparedMemory.revision,
            }
            : this.userMemory.retrieve({
              principal: bundle.principal,
              memoryMode,
              message: input.message,
              workingMemory: seeded,
              goal: seeded.currentGoal,
              intentName: slots.lastIntent,
              ...versionBoundary,
              episodeLimit: 3,
              policy: input.policy || null,
            });
          return chain(retrievedMaybe, (retrieved) => {
            const relevantUserMemories = retrieved.items || [];
            const relevantEpisodes = retrieved.episodes || [];

            context.recentMessages = recentMessages;
            context.conversationSummary = conversationSummary;
            context.workingMemory = seeded;
            context.userMemories = relevantUserMemories;
            context.episodicMemories = relevantEpisodes;
            context.pendingClarification = context.pendingClarification || seeded.pendingClarification || null;

            // Apply soft entity inheritance onto flat context for tools.
            const soft = workingMemoryToSlots(seeded);
            ["className", "teacherName", "courseName", "classroom", "campus", "week", "weekday", "q", "type"].forEach((key) => {
              if ((context[key] === undefined || context[key] === null || context[key] === "")
                && soft[key] != null && soft[key] !== "") {
                context[key] = soft[key];
              }
            });
            if ((context.lastTargetName === undefined || !context.lastTargetName) && soft.lastTargetName) {
              context.lastTargetName = soft.lastTargetName;
              context.lastTargetType = soft.lastTargetType;
            }
            if (context.lastWeek == null && soft.lastWeek != null) context.lastWeek = soft.lastWeek;
            if (context.lastWeekday == null && soft.lastWeekday != null) context.lastWeekday = soft.lastWeekday;

            const conversationState = {
              conversationSummary,
              summary: conversationSummary, // compat for any remaining readers
              recentMessages,
              workingMemory: seeded,
              userMemories: relevantUserMemories,
              episodicMemories: relevantEpisodes,
              pendingClarification: context.pendingClarification,
              contextSlots: state && state.contextSlots || soft,
              memoryMode,
              revision: state && state.revision || 0,
            };

            return {
              principal: bundle.principal,
              state,
              memory: bundle.memory,
              context: safetyGuard.sanitizeAgentContext(context),
              conversationState,
              userMemoryItems: userLoaded.items,
              episodicMemories: relevantEpisodes,
              memoryPolicy: userLoaded.policy,
              memoryRevision: Math.max(userLoaded.revision || 0, retrieved.revision || 0),
              memoryMode,
            };
          });
        });
      });
    };
    if (memoryMode === "cloud_sync" && (versionBoundary.termId || versionBoundary.releaseVersion)) {
      return chain(this.userMemory.invalidateContext({
        principal: bundle.principal,
        memoryMode,
        ...versionBoundary,
      }), afterInvalidate);
    }
    return afterInvalidate();
  }

  /**
   * Commit after a successful turn: working + thread + optional user memory.
   * cancelled / security blocked / true failure do not write.
   */
  commit(input = {}) {
    const memoryMode = input.memoryMode
      || (input.memoryBundle && input.memoryBundle.memory && input.memoryBundle.memory.mode)
      || "local_only";
    const principal = input.principal
      || (input.memoryBundle && input.memoryBundle.principal);
    const prevState = input.state || (input.memoryBundle && input.memoryBundle.state) || null;
    const storedPolicy = input.memoryBundle && input.memoryBundle.memoryPolicy;
    // pause/autoMemoryEnabled=false 只停自动写入（M1/Low#5）：explicit 候选与手动
    // 管理操作由下游服务层豁免。存储策略作为纵深防御与上游传入值取交集。
    const autoMemoryEnabled = input.autoMemoryEnabled !== false
      && !(storedPolicy && (storedPolicy.paused === true || storedPolicy.autoMemoryEnabled === false));

    if (input.cancelled === true || input.securityBlocked === true) {
      return {
        memory: input.memoryBundle && input.memoryBundle.memory || {
          mode: memoryMode,
          authenticated: Boolean(principal && principal.authenticated),
          persisted: false,
          synced: false,
          revision: prevState && prevState.revision || 0,
        },
        skipped: true,
        skipReason: input.securityBlocked ? "security_blocked" : "cancelled",
        workingMemory: normalizeWorkingMemory(prevState && prevState.workingMemory || emptyWorkingMemory()),
        conversationSummary: (prevState && prevState.conversationSummary) || "",
        recentTurns: (prevState && prevState.recentTurns) || [],
        candidates: [],
        userCommit: { persisted: false, keys: [] },
        autoMemoryHints: [],
      };
    }
    // True hard failure without allowed partial success: do not commit.
    if (input.failed === true && input.allowPartialCommit !== true && input.status !== "partial" && input.status !== "completed") {
      return {
        memory: input.memoryBundle && input.memoryBundle.memory || {
          mode: memoryMode,
          authenticated: Boolean(principal && principal.authenticated),
          persisted: false,
          synced: false,
          revision: prevState && prevState.revision || 0,
        },
        skipped: true,
        skipReason: "failed",
        // Fail closed for persistence, but keep the already-sanitized current
        // Turn view in the response so a transient tool/data failure does not
        // erase confirmed entity context from the conversation UI.
        workingMemory: normalizeWorkingMemory(
          input.workingMemory
          || prevState && prevState.workingMemory
          || emptyWorkingMemory()
        ),
        conversationSummary: (prevState && prevState.conversationSummary) || "",
        recentTurns: (prevState && prevState.recentTurns) || [],
        candidates: [],
        userCommit: { persisted: false, keys: [] },
        autoMemoryHints: [],
      };
    }

    const prevWorking = normalizeWorkingMemory(
      input.workingMemory
      || prevState && prevState.workingMemory
      || emptyWorkingMemory()
    );

    const toolNames = (Array.isArray(input.toolCalls) ? input.toolCalls : [])
      .map((c) => c && c.name)
      .filter(Boolean);
    const observations = Array.isArray(input.observations) ? input.observations : [];
    const durableClassification = { toolNames, intentName: input.intentName };
    const durableUserMessage = sanitizeDurableTurnText(input.message, {
      ...durableClassification,
      role: "user",
    });
    const durableAssistantAnswer = sanitizeDurableTurnText(input.answer, {
      ...durableClassification,
      role: "assistant",
    });
    const durableObservations = observations.map((observation) => Object.assign({}, observation, {
      summary: sanitizeDurableTurnText(observation && observation.summary, {
        ...durableClassification,
        role: "assistant",
      }),
    }));
    const writeOps = (Array.isArray(input.toolCalls) ? input.toolCalls : [])
      .filter((c) => c && c.result && c.result.requiresConfirmation)
      .map((c) => ({ tool: c.name, status: "awaiting_confirmation" }));

    const workingMemory = updateWorkingMemory(prevWorking, {
      message: input.message,
      intentName: input.intentName,
      slots: input.slots || {},
      contextSlots: input.contextSlots || {},
      campus: input.context && input.context.campus,
      preferredName: input.preferredName
        || (input.preferencePatch && input.preferencePatch.preferredName)
        || prevWorking.preferredName,
      pendingClarification: input.clearPendingClarification ? null : input.pendingClarification,
      executedTools: toolNames,
      observations: durableObservations,
      pendingWriteOps: writeOps,
      pendingAction: input.pendingAction,
      lastResolvedEntity: input.lastResolvedEntity,
      providerUsed: input.providerUsed,
      understandingSource: input.understandingSource,
      goalContract: input.goalContract,
      lastRecommendation: input.lastRecommendation || (
        durableAssistantAnswer
          ? { summary: durableAssistantAnswer.slice(0, 120), count: toolNames.length }
          : null
      ),
    });

    const rawCandidates = (input.memoryCandidates || extractMemoryCandidates({
        message: input.message,
        runId: input.runId,
        providerPayload: input.providerPayload,
      })).concat(
        input.preferencePatch
          ? Object.keys(input.preferencePatch).map((key) => ({
            type: "preference",
            key,
            value: input.preferencePatch[key],
            scope: "user",
            confidence: 0.95,
            reasonCode: "preference_patch",
            source: "explicit_user",
          }))
          : []
      );
    const semanticValidation = validateMemoryCandidates(rawCandidates, {
      message: input.message,
      memoryMode,
    });
    const candidates = filterAndMergeCandidates(
      semanticValidation.accepted,
      { memoryMode, autoMemoryEnabled, policy: input.policy || null }
    );

    // Apply durable name/campus into working memory for this thread immediately.
    // Never retain an unvalidated name written by an upstream interpreter or a
    // legacy working snapshot. Accepted candidates below are the only updater.
    workingMemory.preferredName = isInvalidPreferredName(prevWorking.preferredName)
      ? ""
      : prevWorking.preferredName;
    candidates.forEach((c) => {
      if (c.key === "preferredName") workingMemory.preferredName = c.value;
      if (c.key === "campus" && c.scope === "user") workingMemory.campus = c.value;
      // 身份事实（学院/专业/年级）无论是否可持久化，都先落到线程级 working memory。
      if (c.key === "college") workingMemory.college = c.value;
      if (c.key === "major") workingMemory.major = c.value;
      if (c.key === "grade") workingMemory.grade = c.value;
      if (c.key === "tempStudySpot") {
        workingMemory.classroom = c.value;
        workingMemory.confirmedEntities.tempStudySpot = c.value;
      }
      if (c.type === "named_relation" && c.value && c.value.relation && c.value.name) {
        // 类型化关系记忆仅入 Working Memory（第三方人物默认不进长期 User Memory）；同 relation 覆盖即纠正
        const rel = {
          relation: String(c.value.relation).slice(0, 24),
          displayRelation: String(c.value.displayRelation || c.value.relation).slice(0, 16),
          name: String(c.value.name).slice(0, 24),
        };
        const list = Array.isArray(workingMemory.namedRelations) ? workingMemory.namedRelations.slice() : [];
        const idx = list.findIndex((r) => r && r.relation === rel.relation);
        if (idx >= 0) list[idx] = rel;
        else list.push(rel);
        workingMemory.namedRelations = list.slice(0, 8);
      }
      if (c.type === "named_relation_forget" && c.value && c.value.relation) {
        const list = Array.isArray(workingMemory.namedRelations) ? workingMemory.namedRelations.slice() : [];
        workingMemory.namedRelations = list.filter((r) => r && r.relation !== c.value.relation);
      }
    });

    // M1：偏好/约束/Episode 收敛为一个确定性 Mutation Plan + 一次权威 mutate。
    // expectedRevision 来自本轮 load 的 memoryRevision；冲突重试与 fail-soft
    // 由 UserMemoryStore.commit 统一编排（禁止并行批量并发写同一用户记忆）。
    const expectedMemoryRevision = input.expectedMemoryRevision !== undefined && input.expectedMemoryRevision !== null
      ? Number(input.expectedMemoryRevision)
      : (input.memoryBundle && Number(input.memoryBundle.memoryRevision)) || 0;
    const episodeRequested = input.status === "completed" && input.failed !== true
      && input.allowPartialCommit !== true && input.verified === true
      && autoMemoryEnabled && toolNames.length && input.intentName;
    const commitContext = {
      input,
      memoryMode,
      principal,
      prevState,
      workingMemory,
      candidates,
      toolNames,
      durableUserMessage,
      durableAssistantAnswer,
      episodeRequested,
      semanticValidation,
    };
    return chain(this.userMemory.commit({
      principal,
      memoryMode,
      autoMemoryEnabled,
      candidates,
      message: input.message,
      policy: input.policy || null,
      episode: episodeRequested
        ? {
          goal: input.intentName,
          outcomeSummary: `已成功完成 ${String(input.intentName).slice(0, 80)}`,
          reusableConstraints: {
            campus: workingMemory.campus || "",
            weekday: workingMemory.weekday || 0,
            period: workingMemory.periodHint || "",
            type: workingMemory.lastResolvedEntity && workingMemory.lastResolvedEntity.type || "",
            targetName: workingMemory.lastResolvedEntity && workingMemory.lastResolvedEntity.name
              || workingMemory.className || workingMemory.teacherName || workingMemory.courseName || "",
          },
          provenanceRunId: input.runId || "",
          status: "success",
        }
        : null,
      verified: input.verified === true,
      expectedRevision: expectedMemoryRevision,
      runId: input.runId,
      conversationId: input.conversationId,
      policyVersion: storedPolicy && storedPolicy.configVersion || "",
      termId: input.context && (input.context.term || input.context.semester) || "",
      releaseVersion: input.context && input.context.releaseVersion || "",
    }), (userCommit) => this._finishCommit(commitContext, userCommit));
  }

  _finishCommit(ctx, userCommit) {
    const {
      input,
      memoryMode,
      principal,
      prevState,
      workingMemory,
      candidates,
      toolNames,
      durableUserMessage,
      durableAssistantAnswer,
      episodeRequested,
      semanticValidation,
    } = ctx;
    const episodeCommit = userCommit && userCommit.episode
      ? userCommit.episode
      : { persisted: false, reason: episodeRequested ? "" : "not_successful_task" };

    const conversationSummary = buildSemanticSummary({
      previousSummary: prevState && prevState.conversationSummary || "",
      intentName: input.intentName,
      workingMemory,
      completedTools: toolNames,
      resultSummary: durableAssistantAnswer,
      corrections: candidates.filter((c) => c.correction).map((c) => `${c.key}=${c.value}`),
    });

    const prevTurns = prevState && Array.isArray(prevState.recentTurns) ? prevState.recentTurns : [];
    // Persist recent turns for both session_state and cloud_sync (desensitized); turnId dedupe.
    const recentTurns = memoryMode === "local_only"
      ? []
      : mergeRecentTurns(prevTurns, durableUserMessage, durableAssistantAnswer, input.intentName, {
        runId: input.runId || "",
      });

    // Working memory is authoritative for entity continuity; input slots fill gaps only.
    const fromWorking = workingMemoryToSlots(workingMemory);
    const fromInput = input.contextSlots && typeof input.contextSlots === "object" ? input.contextSlots : {};
    const contextSlots = Object.assign({}, fromInput, fromWorking);
    // Never let stale 0 week/weekday from callers overwrite real working values.
    ["lastWeek", "lastWeekday", "week", "weekday", "sectionStart", "sectionEnd"].forEach((key) => {
      if (contextSlots[key] === 0 || contextSlots[key] === "0") {
        contextSlots[key] = fromWorking[key] != null ? fromWorking[key] : null;
      }
    });
    if (workingMemory.preferredName) {
      contextSlots.preferredName = workingMemory.preferredName;
    }
    if (workingMemory.className) {
      contextSlots.className = workingMemory.className;
      contextSlots.lastTargetName = workingMemory.className;
      contextSlots.lastTargetType = "class";
      contextSlots.q = workingMemory.className;
    }
    if (workingMemory.periodHint) {
      contextSlots.periodHint = workingMemory.periodHint;
    }

    return chain(this.conversationMemory.persistAfterSuccess({
      principal,
      state: prevState,
      conversationId: input.conversationId,
      memoryMode,
      cloudSyncEnabled: memoryMode === "cloud_sync" || input.cloudSyncEnabled === true,
      message: durableUserMessage,
      answer: durableAssistantAnswer,
      intentName: input.intentName,
      context: input.context,
      runId: input.runId,
      status: input.status || "completed",
      stepCount: input.stepCount || 0,
      contextSlots,
      pendingClarification: input.clearPendingClarification ? null : input.pendingClarification,
      clearPendingClarification: input.clearPendingClarification,
      evidence: input.evidence,
      evidenceRefs: input.evidenceRefs,
      failed: input.failed,
      cancelled: input.cancelled,
      securityBlocked: input.securityBlocked,
      // Extended fields consumed by enhanced persist (see conversationMemoryService patch).
      workingMemory,
      conversationSummary,
      recentTurns,
      forceRecentTurns: memoryMode !== "local_only",
    }), (memory) => ({
      memory,
      workingMemory,
      conversationSummary,
      recentTurns,
      candidates,
      userCommit,
      episodeCommit,
      memoryWrite: {
        status: userCommit && userCommit.writeStatus || "succeeded",
        attemptCount: userCommit && userCommit.attemptCount || 0,
        revision: userCommit && userCommit.revision || 0,
      },
      memoryValidation: {
        acceptedCount: semanticValidation.accepted.length,
        rejectedCount: semanticValidation.rejected.length,
        rejected: semanticValidation.rejected,
      },
      autoMemoryHints: userCommit.persisted
        ? userCommit.keys.map((key) => {
          if (key === "campus") return "已记住你的常用校区，可在记忆设置中修改。";
          if (key === "preferredName") return "已记住你的称呼，可在记忆设置中修改。";
          if (key === "defaultReminderLeadMinutes") return "已记住默认提醒时间，可在记忆设置中修改。";
          if (key === "preferredBuilding") return "已记住你的常用楼栋，可在记忆设置中修改。";
          if (key === "college") return "已记住你的学院，可在记忆设置中修改。";
          if (key === "major") return "已记住你的专业，可在记忆设置中修改。";
          if (key === "grade") return "已记住你的年级，可在记忆设置中修改。";
          return "";
        }).filter(Boolean).slice(0, 1)
        : [],
    }));
  }

  /**
   * 提交客户端 Action Receipt 带来的记忆变更（setCurrentSchedule + 提醒类命令）。
   * 调用前提：路由层已完成 command/status 校验与目标存在性验证。
   * 持久化仅在 cloud_sync 模式生效；local_only 模式工作记忆由客户端本地持有，
   * 服务端返回规范化结果但不落盘。
   */
  commitActionReceipt(input = {}) {
    const memoryMode = input.memoryMode === "cloud_sync" ? "cloud_sync" : "local_only";
    const command = String(input.command || "");
    const isReminderCommand = REMINDER_RECEIPT_COMMANDS.indexOf(command) >= 0;
    const target = input.appliedTarget && typeof input.appliedTarget === "object"
      ? input.appliedTarget
      : null;
    if (!target || !target.detailId || !target.name) {
      return { committed: false, reason: "TARGET_MISSING" };
    }
    const prevState = input.state || null;
    const prevWorking = normalizeWorkingMemory(
      prevState && prevState.workingMemory || emptyWorkingMemory()
    );
    if (memoryMode === "cloud_sync") {
      const authorized = Boolean(
        input.principal && input.principal.authenticated === true
        && prevState && prevState.memoryPolicy
        && prevState.memoryPolicy.mode === "cloud_sync"
        && prevState.memoryPolicy.cloudSyncEnabled === true
      );
      if (!authorized) {
        return { committed: false, reason: "CLOUD_SYNC_NOT_AUTHORIZED", workingMemory: prevWorking };
      }
      const pending = prevWorking.pendingAction;
      if (!pending || pending.status !== "awaiting_receipt") {
        return { committed: false, reason: "ACTION_RECEIPT_NOT_PENDING", workingMemory: prevWorking };
      }
      if (RECEIPT_COMMANDS.indexOf(pending.command) < 0 || command !== pending.command) {
        return { committed: false, reason: "ACTION_RECEIPT_COMMAND_MISMATCH", workingMemory: prevWorking };
      }
      const runId = String(input.runId || "");
      if (!runId || !pending.runId || runId !== pending.runId) {
        return { committed: false, reason: "ACTION_RECEIPT_RUN_MISMATCH", workingMemory: prevWorking };
      }
      if (pending.expiresAt && Number(pending.expiresAt) < Date.now()) {
        return { committed: false, reason: "ACTION_RECEIPT_EXPIRED", workingMemory: prevWorking };
      }
      const pendingTarget = pending.target || {};
      if (!pendingTarget.detailId || String(pendingTarget.detailId) !== String(target.detailId)) {
        return { committed: false, reason: "ACTION_RECEIPT_TARGET_MISMATCH", workingMemory: prevWorking };
      }
      if (pendingTarget.term && target.term && String(pendingTarget.term) !== String(target.term)) {
        return { committed: false, reason: "ACTION_RECEIPT_TARGET_MISMATCH", workingMemory: prevWorking };
      }
    }
    // 提醒类回执不改写 currentScheduleTarget（提醒目标不是课表目标）；
    // 仅清除 pendingAction 并记录 lastResolvedEntity。课表回执维持既有语义。
    const workingMemory = isReminderCommand
      ? updateWorkingMemory(prevWorking, {
        message: "",
        pendingAction: null,
        lastResolvedEntity: {
          type: "reminder",
          id: String(target.detailId).slice(0, 128),
          name: String(target.name).slice(0, 120),
        },
      })
      : updateWorkingMemory(prevWorking, {
        message: "",
        currentScheduleTarget: {
          type: target.type === "class" ? "class" : "class",
          detailId: String(target.detailId).slice(0, 128),
          name: String(target.name).slice(0, 120),
          term: String(target.term || "").slice(0, 40),
        },
        pendingAction: null,
        lastResolvedEntity: {
          type: "class",
          id: String(target.detailId).slice(0, 128),
          name: String(target.name).slice(0, 120),
        },
      });
    const contextSlots = isReminderCommand
      ? Object.assign({}, workingMemoryToSlots(workingMemory), {
        lastTargetType: "reminder",
        lastTargetName: String(target.name).slice(0, 120),
      })
      : Object.assign({}, workingMemoryToSlots(workingMemory), {
        lastTargetType: "class",
        lastTargetName: workingMemory.currentScheduleTarget.name,
        className: workingMemory.currentScheduleTarget.name,
        preferredClassName: workingMemory.currentScheduleTarget.name,
        q: workingMemory.currentScheduleTarget.name,
      });
    if (memoryMode !== "cloud_sync") {
      return {
        committed: false,
        reason: "LOCAL_ONLY_NO_PERSIST",
        workingMemory,
        contextSlots,
      };
    }
    return chain(this.conversationMemory.persistAfterSuccess({
      principal: input.principal,
      state: prevState,
      conversationId: input.conversationId,
      memoryMode,
      cloudSyncEnabled: true,
      message: "",
      answer: "",
      intentName: isReminderCommand ? "manage_course_reminders" : "set_current_schedule",
      context: input.context || {},
      runId: input.runId || "",
      status: "completed",
      stepCount: 0,
      contextSlots,
      // 沿用既有摘要与最近轮次，避免 Receipt 提交污染对话痕迹。
      conversationSummary: (prevState && prevState.conversationSummary) || "",
      recentTurns: (prevState && Array.isArray(prevState.recentTurns)) ? prevState.recentTurns : [],
      workingMemory,
    }), (memory) => ({ committed: true, reason: "", workingMemory, contextSlots, memory }));
  }

  buildConversationState(bundle) {
    if (!bundle) {
      return {
        conversationSummary: "",
        summary: "",
        recentMessages: [],
        workingMemory: emptyWorkingMemory(),
        userMemories: [],
        episodicMemories: [],
        pendingClarification: null,
        contextSlots: {},
        memoryMode: "local_only",
        revision: 0,
      };
    }
    return bundle.conversationState || {
      conversationSummary: bundle.context && bundle.context.conversationSummary || "",
      summary: bundle.context && bundle.context.conversationSummary || "",
      recentMessages: bundle.context && bundle.context.recentMessages || [],
      workingMemory: bundle.context && bundle.context.workingMemory || emptyWorkingMemory(),
      userMemories: bundle.context && bundle.context.userMemories || [],
      episodicMemories: bundle.context && bundle.context.episodicMemories || [],
      pendingClarification: bundle.context && bundle.context.pendingClarification || null,
      contextSlots: bundle.state && bundle.state.contextSlots || {},
      memoryMode: bundle.memoryMode || "local_only",
      revision: bundle.state && bundle.state.revision || 0,
    };
  }
}

const defaultMemoryController = new MemoryController();

module.exports = {
  MemoryController,
  defaultMemoryController,
};
