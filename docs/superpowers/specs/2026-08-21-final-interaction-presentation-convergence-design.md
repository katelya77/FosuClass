# Final Interaction & Presentation Convergence Design

**Date:** 2026-08-21
**Status:** Approved — additive contract closure

## Objective

Freeze the final ADP interaction and presentation surface without changing the established 4-Agent / 13-CampusTool / 14-binding architecture. The work closes three observable drifts: the simplified Final prompts no longer force Child results back through Main when a cross-domain goal remains; the presentation decision is not represented as a deterministic policy; and the Repo still treats the deleted Widget ID as live truth.

## Root cause

The R51 reference prompts explicitly encoded `Main → Child → Main`, but the concise Final Child prompts only described returning facts and completion state. In Tencent free-transfer mode, the Repo Mission planner is not a central runtime dispatcher: the platform model must choose the configured transfer. A Child that has enough facts for its own domain can therefore end the response unless its prompt and transfer description explicitly preserve the residual cross-domain goal. The Main prompt cannot continue a goal when control is never returned.

The Console UI Agent label is not sufficient evidence of the actual route. Keyboard input and Widget `sys.chat` are both expected to create a new user turn, but the Tencent Console trace must be inspected to distinguish “Main was hidden in presentation” from “Main was skipped.” Repo automation freezes the expected contract and records the live probe as `MANUAL_REQUIRED` until Console trace evidence exists.

## Handoff contract

Every new user turn starts at Main. Allowed directed edges are Main→Schedule, Main→Risk, Main→Insight, and each Child→Main. No Child→Child edge exists. A Child may end a turn only when the complete user goal is wholly within its domain and no residual domain work remains; otherwise it returns verified facts and completion state to Main. Main re-evaluates the complete goal after every Child result and emits the final answer only after every required domain outcome is complete.

Canonical transfer descriptions live in `competition/adp-kit/final/console/FINAL-TRANSFER-DESCRIPTIONS.md`. The same topology, start policy, and direct-output guard are encoded in desired state so drift checks do not depend on prose alone.

## Final presentation policy

`FinalPresentationPolicy` is a pure deterministic selector. It consumes a response class, Mission completion state, and an optional validated result card. It returns one of `widget`, `clarify`, `message`, or `text`.

- A verified dynamic campus result with a valid result card uses the unified Widget.
- A compound Mission selects its terminal verified outcome through `FinalOutcomeSelector`; stale intermediate cards cannot win.
- Clarification or L3 confirmation uses the platform clarification presentation, not the result Widget.
- A short static knowledge answer may use the message presentation; very small ordinary dialogue may remain text.
- An invalid Widget payload fails closed to sanitized text and is never rendered.
- CampusTool direct result output is disabled for all 13 operations, preventing tool output from bypassing Main and residual-goal processing.

## Universal Campus Canvas v8

The single visible Widget remains `小序-校园智序结果卡`. The v7 data shape is extended, not replaced: `section.kind` is optional with the enum `metric`, `timeline`, `route`, `recommendation`, `ranking`, `comparison`, `entity-list`, `notice`, and `prose`. Existing `sections`, `rows`, `days`, `actions`, and `layoutMode` remain intact. A v7 payload without `kind` remains valid and follows the current variant fallback rendering.

The deterministic projector assigns module kinds from verified result semantics:

- Schedule week → existing week board; Schedule day → `timeline`.
- Risk transitions → `route`; risk conclusion → `notice`.
- Collaboration and space → `recommendation` plus compact `entity-list`.
- Ranking → `ranking`; overview → `metric` with compact hotspots.
- Reschedule → `comparison` plus `notice` for decisive checks.
- Message → `prose`; empty/error → compact `notice`.

The visual signature is a restrained campus-path spine used by timeline, route, and comparison modules. It communicates time and movement with existing Tencent-supported `Box`, `Row`, `Col`, `Text`, `Caption`, `Badge`, `Divider`, and `Button` components. No unsupported HTML/CSS component and no new business Widget is introduced.

## Real Export oracle

The authoritative Console export is `C:\Users\Katelya\Downloads\小序-校园智序结果卡.widget`, exported after the user re-imported the Widget. Its ID is `601418106a374b2eb7de54c65a3de7e0` and its SHA-256 is `93bbc0b1619ee2bdfbbc7817ad15d3b0ad0a42054a345e35d7ccb290e40ef252`. Its outer schema and encoded schema/default/view are valid. The old ID `978b004b2f054e8bbd5438159c7329ff` is historical only and must not appear in active desired state, contract, audit, bundle, or Final acceptance assets.

## Console and knowledge truth

The user-confirmed Console truth remains four DeepSeek-V3-0324 Agents, Main-start for every new turn, APP data version `competition-demo-v3`, Main with zero CampusTools, and 14 Child bindings. Current retrieval switches are Document ON, QA ON, DB ON. Desired state remains Document ON, Rerank ON, QA OFF, DB OFF, Search OFF, without changing recall count or threshold.

## Verification boundary

Automated tests prove Repo contracts, deterministic selection, v7 compatibility, v8 projection, latest export binding, topology, direct-output guard, privacy, and existing runtime regressions. They cannot prove Tencent Console transfer traces. Keyboard and `sys.chat` live paths remain `MANUAL_REQUIRED` with a minimal probe matrix. ADP is not published and PR #49 remains open and unmerged.
