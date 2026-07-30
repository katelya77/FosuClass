# Xiaofu Agent Product Platform P3 Implementation Plan

**Goal:** Make one production ContextAssembler and one principal-scoped memory repository provide bounded recent context, rolling summaries, working/pending state, semantic long-term memory, successful episodes, version invalidation, and user controls.

**Architecture:** The generic assembler lives in `@xiaofu-agent/agent-runtime` and is invoked by the existing production Fosu composition port before Decision. The existing encrypted user-preference repository is migrated in place to a versioned memory document; compatibility methods remain facades over that single store. Conversation state remains the thread/working source and gains rolling-summary/episode fields rather than a parallel history store.

**Safety:** Only allowlisted low-risk normalized memories and compact successful-task episodes are durable. Full schedules, raw Tool results, weather, credentials, prompts, and hidden reasoning are rejected before persistence and omitted from context.

## Task 1: Acceptance contracts (RED)

- Add generic ContextAssembler contract tests for all nine sections, 8–12 recent messages, redaction, deterministic budget clipping, and immutable output.
- Add long-term repository tests for metadata, hybrid semantic retrieval, supersede, TTL, term/release invalidation, policy pause, optimistic revision, export, and prohibited categories.
- Add a 50+ scenario matrix including a 100-Turn early-fact recovery, ellipsis/anaphora/correction, cross-session/device restore, and memory-mode isolation.

## Task 2: Generic ContextAssembler (GREEN)

- Implement the assembler in `packages/agent-runtime`.
- Produce Decision/Tool/Response safe views from one immutable assembled snapshot.
- Wire `fosuTurnPorts.context` to use that snapshot and pass it to Decision, Tool, Verification, and Response.
- Keep server legacy context helpers as compatibility-only callers of the package implementation where applicable.

## Task 3: Canonical durable memory (GREEN)

- Migrate the encrypted preference document from values-only v1 to entries/policy/episodes v2 with in-place v1 migration.
- Persist provenance, confidence, scope, expiry, status, supersedes, term/release boundaries, revision, audit timestamps, and local feature vectors.
- Implement deterministic lexical + feature-hash vector recall and explainable rerank.
- Atomically supersede conflicting active entries and mark schedule-scoped entries `expired_context` on term/release change.

## Task 4: Rolling thread state and episodes (GREEN)

- Extend conversation schema with bounded rolling summary facts, successful episodes, and pending action.
- Merge summaries instead of overwriting them; keep only normalized facts and compact outcome constraints.
- Recover early confirmed facts after 100 Turns without storing full history.

## Task 5: User controls and production proof

- Add principal-scoped list/patch/delete/clear/pause/resume/export APIs with revision checks and audit metadata.
- Wire the miniprogram memory client/sheet to the real APIs while preserving local_only/session_state/cloud_sync semantics.
- Add production Trace proof that the package assembler and retrieved memory IDs were used without exposing memory content.
- Run P3, Phase 2/3, foundation, regression, competition, final-convergence, release, and secret gates; record evidence and commit P3.
