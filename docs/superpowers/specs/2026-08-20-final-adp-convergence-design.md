# Final ADP Convergence Design

**Date:** 2026-08-20
**Status:** Approved (Option A)
**Scope:** Final Golden convergence of the existing four-Agent ADP runtime, deterministic Mission/Decision projection, one unified Native Widget, and auditable Console handoff.

## Goal

Turn the existing Campus Steward runtime into a competition-ready final experience without changing the Agent topology, CampusTool APIs, anonymous competition dataset, or verified-fact boundaries.

The product promise is: **以课表为核心，把校园中的人、时间、空间和教学资源连接起来，并继续完成查询、分析、检查和决策任务。**

## Source-of-truth order

1. User-confirmed Console state after 21:03 on 2026-08-20.
2. Latest safe runtime-control-plane snapshot when readable.
3. Canonical Git sources.
4. The 20:30 ADP application ZIP, used only for historical structure and non-secret IDs.

The application ZIP must never restore old models, greeting, opening questions, workflows, QA/DB switches, or stale data-version metadata.

## Chosen architecture

The approved approach preserves the real exported Widget's 15-field public contract and improves semantics before presentation. This avoids an unproven schema expansion while allowing a full UX redesign with the components Tencent ADP demonstrably supports.

```text
verified CampusTool facts
        |
Mission completion + current goal
        |
FinalOutcomeSelector
        |
Decision Core structured semantics
        |
Deterministic PublicCopyProjector
        |----------------------|
PublicDecisionReceipt      WidgetViewModel
                                  |
                   one Native Widget, variant-aware View
```

## FinalOutcomeSelector

Selection is based on the current structured goal and completed mission criteria, never the first tool result or a stale intermediate card. The selector is deterministic and fail-closed.

- Teaching-assurance missions prefer completed risk evidence over schedule evidence.
- Collaboration missions prefer the completed group plan over intermediate availability queries.
- Operations drill-down uses the currently requested terminal outcome (ranking, schedule, or risk).
- An incomplete or unverified terminal result cannot displace a verified completed result.
- A verified authoritative Decision recommendation cannot be reordered by model copy.

## Public copy projection

Internal constraint IDs and evaluator text remain available to deterministic internals but never cross the public boundary. A shared projector consumes structured constraint/reason semantics plus verified candidate attributes and produces bounded Chinese copy.

- Known structured semantics map to fixed public templates.
- Computed values come only from verified candidate/constraint fields.
- Unknown or malformed semantics are omitted, not freely translated.
- Receipt and Widget use the same projected reasons.
- No evidence means no reason.
- No viable candidate means no recommendation.

## Widget contract and UX

The only user-visible Widget remains `小序-校园智序结果卡`.

Compatibility oracle:

- Widget ID `978b004b2f054e8bbd5438159c7329ff`.
- Supported components: Card, Box, Row, Col, Title, Text, Caption, Badge, Divider, Button.
- Actions: only `sys.chat` with exactly `{ query: natural-language task }`.
- The 15 public fields remain unchanged.
- `displayMeta.tieGroupCount` is omitted when zero; when present it is an integer of at least one, matching the real export.

The visual system is **Temporal Campus OS**: warm neutral canvas, dark primary ink, restrained campus green, blue for action, amber/red only for risk. Each variant has one Hero, compact facts, bounded explanation/alternatives, and one to three useful actions.

Variant behavior:

- schedule-week: two-column temporal day board; empty days omitted.
- schedule-day: vertical timeline rather than a week grid.
- space: result count, one recommended room, at most five visible alternatives, remaining count.
- collaboration: recommended time, participants, first-choice space, deterministic reasons, compact alternatives.
- risk: risk-specific title/Hero and human-readable transition narrative.
- reschedule: before-to-after comparison and decisive checks.
- ranking: Top 1 Hero plus at most four following ranks.
- overview: one overall judgment plus compact metrics/hotspots.
- empty/error: minimal recoverable state without protocol or stack details.

## Prompt convergence

Four new canonical prompts live under `competition/adp-kit/final/prompts/`. Historical R51 prompts remain unchanged.

- Main understands the goal, restores reliable context, delegates by three business domains, assesses completion, clarifies once when essential, and composes the final answer.
- Main has zero CampusTools and does not list the 13 operations.
- Children handle one professional domain, retrieve fresh verified facts when dynamic constraints change, and return concise facts/completion state.
- Authoritative recommendations are never reranked by the model.
- No prompt assumes a bound image-understanding tool. Future visual input is merely unverified observation and cannot satisfy dynamic fact requirements.
- Final answers lead with the conclusion and do not expose orchestration or protocol vocabulary.

## Console and knowledge convergence

The desired final Console truth records:

- four Agents, all DeepSeek-V3-0324;
- 13 unique public CampusTools, 14 Child bindings, Main CampusTools = 0;
- three final opening questions and the user-confirmed greeting/description;
- six retained `*-END` workflows, all disabled and unreachable;
- deleted node-seed workflow remains absent;
- TEST QA remains absent;
- Document Retrieval ON, Rerank ON, QA/DB/Search OFF;
- multimodal contracts remain future-ready, but no image tool is required for final text runtime;
- no application release or publish.

When the ADP API is unreadable or its write schema is not proven, the repository records `MANUAL_REQUIRED` rather than claiming success.

## Runtime and deployment boundary

If PublicCopyProjector, FinalOutcomeSelector, or Widget result projection changes the Cloud Function copy, the synchronized `campusflowAdpTools` code is deployed code-only after all gates pass. Environment variables, function configuration, authentication, data sources, and unrelated cloud resources are untouched. ADP is not published.

## Verification

TDD covers the six required attacks, prompt generalization, public leakage, schema drift, all ten Widget variants, Mission/Decision regression, r49-ma, knowledge, MCP/golden, root Agent suites, security/privacy, manifest, and `git diff --check`.

Product acceptance requires that a non-technical student or teacher can identify the answer within three seconds and that the result reads like a campus product rather than formatted backend JSON.
