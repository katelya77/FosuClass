# R50.1.1 Console Contract Consistency Design

## Goal

Close the remaining R50.1 control-plane drift before ADP console cutover: make the canonical Agent-to-CampusTools binding map, console manuals, automated prompt/tool gates, and competition-demo-v3 type contract agree exactly.

## Scope

R50.1.1 is a bounded consistency hotfix. It does not add CampusTools, does not change CampusTools business semantics, does not change CloudBase endpoint/authentication, does not deploy CloudBase, does not alter the 4 R50.1 final prompts, and does not start Widget/UI work.

## Canonical Agent Binding Map

- Main: no CampusTools; KnowledgeRetrievalAnswer + Agent transfer only.
- Schedule: campus_schedule_query, campus_schedule_range_query, campus_classroom_search, campus_entity_search, campus_academic_context, campus_common_free_time_query, campus_group_plan.
- Risk: campus_risk_check, campus_day_plan, campus_academic_context, campus_reschedule_feasibility.
- Insight: campus_overview, campus_teacher_load_query, campus_room_utilization_query.

There are 13 unique Agent Tool operations and 14 Agent bindings because campus_academic_context is intentionally shared by Schedule and Risk. No other CampusTool may be cross-domain duplicated.

## Root Cause

R50.1 Prompt architecture/tests encode the canonical map, but R50.1-ADP-CONSOLE-CUTOVER.md drifted to a different manual map. The manual also incorrectly stated that every Agent Tool appears exactly once. This is documentation/control-plane drift, not a Runtime semantic defect.

A second independent consistency debt exists in contracts.ts: runtime data is competition-demo-v3, while CompetitionDataVersion currently admits only v1|v2. Runtime loading is dynamic, so this has not broken execution, but the type contract is stale.

## Required Changes

1. Add an automated console-contract consistency test that derives/asserts the canonical binding map and ensures the console cutover/acceptance docs match it.
2. Fix R50.1-ADP-CONSOLE-CUTOVER.md and any R50.1 acceptance/runtime docs that repeat the stale binding statement.
3. Extend CompetitionDataVersion/DATA_VERSIONS to include competition-demo-v3 while preserving v1/v2 compatibility.
4. Add/adjust a type-level/runtime contract test proving v3 is accepted without changing the current runtime dataset selection behavior.
5. Update current checkpoint/final report with an R50.1.1 note; do not rewrite historical incident reports.

## Verification

- New consistency test must fail on pre-fix R50.1 documentation and pass after the fix.
- MCP tests and TypeScript check must pass with competition-demo-v3 in the union.
- Existing R50/R50.1 prompt tests and Generic E2E remain green.
- git diff --check clean.
- PR #49 remains OPEN / UNMERGED.
- No CloudBase deployment and no ADP formal publish.

## Follow-up Gate

After R50.1.1 is green, the user performs ADP Console Cutover and D1-D6 plus semantic boundary checks. Only after that Console Gate passes should the project enter R50.2 Visual Experience & Widget System.
