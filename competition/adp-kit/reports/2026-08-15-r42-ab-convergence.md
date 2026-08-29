# CampusFlow ADP R4.2 A+B Convergence

## Goal
Upgrade the latest user-exported 01–05 R4-UX-Pro workflows and bound Widgets into a three-campus, privacy-safe ADP runtime while keeping the stable logic from the two-campus plan.

## Root causes confirmed
1. R4 presentation sanitizers were present on pre-tool normalization nodes. Canonical values such as `校区A` / `教师003` were converted back to UI aliases `A校区` / `T03老师` before CampusTools, causing false `ENTITY_NOT_FOUND` and recovery cards.
2. 01 did not have a deterministic same-task state merge before required-field validation, so follow-ups such as `只看周三` lost the previously confirmed teacher.
3. Knowledge/app/workflow/tool naming had drifted into multiple sources of truth.

## R4.2 runtime contract
User-facing aliases and tool Canonical values are separate namespaces:

- A校区 / B校区 / C校区 -> 校区A / 校区B / 校区C
- T01老师…T12老师 -> 教师001…教师012
- G01班…G06班 -> 2025级A班…2025级F班

The only valid data flow is:
`user input -> confirmed same-task state merge -> alias-to-Canonical normalization -> CampusTools -> verification -> presentation adapter -> user-facing aliases`.
Presentation sanitizers must never run before tools.

## Data contract
Local delivery introduces `competition-demo-v2` with 3 campuses, 3 colleges, 6 classes, 12 teachers, 24 anonymous courses, 36 rooms, 58 lesson templates and one demo user. It includes deterministic demo scenarios for A→B and B→C teacher rush, a conflict case, and real C-campus room/lesson inventory.

## Workflow convergence
- 01: deterministic multi-turn state recovery (`T03周一 -> 只看周三 -> 那整周呢`).
- 02: preserves campus/date/period/capacity across `换B校区 -> 改节次 -> 换C校区` and keeps Canonical values until tool completion.
- 03: single-teacher rush intent becomes self-compare; two-entity comparison remains supported.
- 04: preserves the successful day-plan path and adds same-task date/campus inheritance.
- 05: uses deterministic campus overview output and exposes all three campuses without hardcoded v1 totals.

## UI and knowledge
Seven bound Widget IDs are preserved, including the current schedule Widget. Ordinary cards hide dataVersion/queryId/hash/RuntimeSafe/source-fingerprint engineering text. Seven knowledge documents and application role/welcome examples are rewritten to one R4.2 contract.

## Verification
Local verification: `20 passed` covering data integrity, designed scenarios, WorkflowID preservation, byte-identical XLSX support files, code compilation, graph references, multi-turn state recovery, C-campus bindings, Widget IDs/privacy, knowledge/app convergence and ZIP round-trip.

Tencent ADP live execution still requires user-side smoke testing after deployment/import; this branch intentionally does not claim a live platform pass and is not merged or published automatically.
