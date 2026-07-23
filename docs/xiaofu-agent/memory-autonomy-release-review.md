# Memory Autonomy Release Review (PR #29)

**Review date:** 2026-07-24  
**Initial HEAD:** `2dbbc77a`  
**Branch:** `feat/xiaofu-agent-memory-autonomy`  
**Method:** Call-site evidence (not filenames alone). Resolutions are wire-or-delete.

---

## 1. Proactive Engine — production call?

| Finding | Evidence |
|--------|----------|
| **Before fix:** Dead import | `agentService.js` imported `evaluateProactive` / `factsFromToolCalls` but never called either (only require line). |
| **No HTTP entry** | `server/src/routes/ai.js` had no `/agent/proactive/*` route. |
| **Client path was local-only** | `packageXiaofu/.../ai-assistant.js` used `aiAssistantService.buildProactiveWorkspace` — client heuristics, not server engine. |

**Resolution:** Wire `POST /api/ai/agent/proactive/evaluate`; attach optional `proactiveSuggestion` on chat when event provided; durable cooldown store; miniprogram calls evaluate endpoint on real product events.

---

## 2. Which miniprogram events trigger proactive?

| Event | Trigger surface |
|-------|-----------------|
| `assistant_open` | Open 小佛助手 (low-frequency, once per open) |
| `today_schedule_open` | Today schedule page open / insight refresh |
| `personal_schedule_imported` | After successful personal import |
| `release_pack_changed` | Detected release fingerprint change |
| `campus_task_completed` | Soft follow-up only when high-value |

No background polling; no model call for proactive.

---

## 3. Proactive → Protocol → UI?

| Layer | Field / component |
|-------|-------------------|
| Protocol | `proactiveSuggestion: { type, title, body, actions, source, expiresAt }` on agent.v2 responses / evaluate API |
| UI | Dismissible suggestion strip (not fact card); opt-out per type stored locally |

---

## 4. MemoryController sole write entry?

| Path | Before | After |
|------|--------|-------|
| `defaultMemoryController.load/commit` in `agentService` | Yes (main path) | Sole authority |
| `personalMemoryInterpreter` → `preferenceService.upsert` | **Independent dual-write** | Emits candidates / `preferencePatch` only; commit via MemoryController |
| `toolRegistry` reminder preference upsert | Direct prefs for explicit tool | Retained only for confirmed tool write path with same policy gates |
| `routes/ai.js` clear/list/remove | Admin-style prefs API | Goes through preference service as persistence layer only |

---

## 5. personalMemoryInterpreter dual write?

**Before:** `resolvePersonalMemoryTurn` called `preferenceService.upsert` then `attachMemory` also committed via MemoryController → double path.  
**After:** Interpreter only detects commands / name questions; `preferencePatch` / session facts handed to MemoryController. No independent durable write.

---

## 6. session_state vs cloud_sync scopes

| Mode | Server session (thread + working) | User Memory (prefs) |
|------|-----------------------------------|---------------------|
| `local_only` | No server persistence | No |
| `session_state` | Current `conversationId` only; ~7d TTL; recent msgs + summary + working | **No** cross-conversation User Memory |
| `cloud_sync` | Same as session_state + longer thread TTL | Low-risk prefs across devices/conversations |

**Before bug:** `mayAutoPersistUserMemory` and `UserPreferenceService.upsert` treated `session_state` like `cloud_sync`.  
**After:** Durable user prefs only when `memoryMode === "cloud_sync"`.

---

## 7. Capability Router missing Manifest skills?

**Before:** Hard-coded `INTENT_RELATED_SKILLS` + `MESSAGE_TOOL_HINTS` were primary selection; skills not in the map could be dropped.  
**After:** Lightweight scoring over all manifest skills (intent support, description keywords, message, working entities, page, personal schedule, tool prereqs/health, runtime mode). Hints are small weights only. Cap: 1–3 skills, ≤12 tools.

---

## 8. Multi-skill completion verification

**Before:** Primary skill `resultVerifier` only.  
**After:** Goal Contract `requiredOutcomes` on multi-goal plans; loop verifies each outcome (or explicit acceptable partial) before stop.

---

## 9. Replan re-running successful tools?

**Before:** Replan executed full step list again (empty-room recovery added steps, but successful schedule/weather could re-run if present).  
**After:** Run-scoped tool result cache keyed by `toolName + canonicalArgs + releaseVersion + term + principal scope`. Read tools reuse successful observations; write tools never auto-repeat; metrics: `reusedToolCount`, `avoidedDuplicateCalls`, `replanReason`, `partialCompletion`.

---

## 10. PR tests in GitHub Actions / deploy gate?

| Before | After |
|--------|-------|
| No `xiaofu-agent-ci.yml` | Added; runs `test:agent-release-gate` on Agent/miniprogram paths + push main |
| Deploy CI only `release:preflight` | Deploy runs same `test:agent-release-gate` after preflight, before SCP |

---

## 11. Memory panel “edit / source / forget”

| Claim | Reality before | After |
|-------|----------------|-------|
| Forget | DELETE prefs API ✓ | Keep |
| Edit | Copy said “可修改” but only forget button | Real PATCH edit for 称呼/校区/楼栋/提醒/回答偏好 |
| Source | `sourceText` often empty | No “查看来源” placeholder; show scope + updatedAt when known |
| Pause auto-memory | Missing | Toggle → server memory policy / preference flag |
| Clear current / all | Present | Wired through server APIs; UI after success only |

---

## 12. Uncalled / dead modules (wire-or-delete)

| Item | Decision |
|------|----------|
| `proactiveEngine.js` (import-only) | **Wire** to route + optional chat field |
| Parallel `summary` as live strategy | Keep as **compat alias** of `conversationSummary` only; internal writers use `conversationSummary` |
| In-process cooldown `Map` | **Replace** with durable bounded file store |
| Hard-only capability maps | **Demote** to weights under scoring |

---

## Commit / security notes

- Do not commit `.env`, tokens, cookies, audit run logs, temp files.
- public runtime: `externalProviderUsed === false` for fact tasks.
- Clear memory wipes Working + Thread + User for intended scope.
