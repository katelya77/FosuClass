# CampusFlow ADP B+ Privacy-Safe Demo Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current 01–05 Tencent ADP R3 exports into a competition-ready B+ demo that is privacy-safe, interaction-stable, source-explainable, and visibly demonstrates multi-week timetable/resource/risk planning without exposing school-identifying data.

**Architecture:** Keep Tencent-exported workflow IDs, real Widget bindings, XLSX import headers, and deployed CampusTools contracts unchanged. Add a presentation-side B+ pseudonymization layer in workflow adapters, harden all required Widget primitives, make follow-up actions deterministic and materially different, and use 05 as the multi-week overview/entry point. Ship a separate anonymized schedule workbook + manifest for judges; never ship a reverse mapping.

**Tech Stack:** Tencent ADP Workflow V2_6 JSON/XLSX import format, Python3 Code Executor nodes, existing RuntimeSafe primitive-only Widgets, CampusTools HTTP APIs, Python/openpyxl validation tooling.

## Global Constraints

- No real school name, campus name, college name, course name, teacher name, class name, building name, room name, internal ID, source URL, or reversible mapping in the competition-facing bundle.
- Stable visible aliases only: 教学区α/β, 样例班A1/A2/B1/B2, 教师T01…T08, generic course module codes, anonymous room/building codes.
- Internal deployed `competition-demo-v1` names may be used only inside workflow normalization code to call frozen CampusTools; they must be pseudonymized before Widget/Answer output and before action messages visible to the user.
- Do not invent a claim that the competition fixture is a verbatim real-school schedule. Label it as a privacy-preserving competition snapshot / structure-derived demo.
- Preserve the five user-exported R3 workflow IDs and the seven real Widget IDs already bound in Tencent ADP.
- No new production deployment, no PR merge, no formal ADP publish.

---

## Task 1: Regression tests for current user-reported failures
- [ ] Build a local workflow validator that loads all five R3 exports and asserts import XLSX headers remain byte-compatible.
- [ ] Add a failing assertion for 01: every required Schedule Widget input must be non-empty even when query result has exactly one item.
- [ ] Add failing assertions that each workflow’s action messages are distinct and context-changing.
- [ ] Add privacy tests that reject school-identifying/raw fixture labels in all Widget-facing adapter outputs and example queries.
- [ ] Run tests and confirm RED on the current exports.

## Task 2: B+ pseudonymization contract
- [ ] Implement one deterministic alias dictionary shared conceptually by 01–05 adapters: campuses, buildings, rooms, classes, teachers, courses.
- [ ] Add reverse alias normalization only inside tool-input normalizers; do not emit/store a reverse-map artifact.
- [ ] Replace visible `competition-demo-v1` / raw hash with `B+匿名快照` and a derived public source fingerprint.
- [ ] Validate that tool calls still use the existing frozen CampusTools entity vocabulary while all user-visible outputs use B+ aliases.

## Task 3: Fix and enhance 01 multi-dimensional schedule
- [ ] Harden DAY/WEEK/DATE Schedule adapters so unused item slots emit non-empty safe placeholders while `shownCount` controls visual display.
- [ ] Change action prompts to deterministic in-workflow follow-ups (whole week, nearest active day, next active day/risk) rather than prompts that can return the identical card.
- [ ] Update extractor examples to accept B+ aliases and map them back internally before `query_schedule`.
- [ ] Add B+ judge/demo examples covering class, teacher, room, course, day, week and date views.

## Task 4: Enhance 02/03/04 follow-up behavior
- [ ] 02: make “换个时段/换个教学区” actions carry concrete alternative period/campus constraints; pseudonymize all room/location output.
- [ ] 03: make comparison/risk actions change week/day/focus deterministically; pseudonymize compared entities, course and locations.
- [ ] 04: keep day-plan responsibility clear; make follow-up actions change date or produce a concrete room-search handoff message with date/period/capacity context; pseudonymize all displayed schedule facts.
- [ ] Ensure all required Widget primitives are always populated.

## Task 5: Turn 05 into the judge-facing multi-week overview
- [ ] Keep the real CampusOverview Widget ID and primitive schema unchanged.
- [ ] Present a six-week window beginning 2026-08-25 with a clear preparation phase and four teaching-week rows, not a fake claim of classes before the teaching start.
- [ ] Replace raw campus/teacher labels with B+ aliases; show aggregate lesson/resource/risk metrics and a public B+ source fingerprint.
- [ ] Make the four actions materially distinct: weekly timetable drilldown, room-resource drilldown, teacher-load drilldown, risk drilldown. Action messages must be B+ aliases and include Action Protocol V2 intent/context.
- [ ] Add judge-oriented example queries for overview, week drilldown, room pressure and risk.

## Task 6: Source-explainability artifacts
- [ ] Generate `BPlus-匿名课表样例.xlsx` with several representative weeks, columns for week/day/period/time/course/teacher/class/teaching-area/building/room, all anonymized.
- [ ] Generate `BPlus-数据来源与隐私说明.json` with schema version, term window, derivation claim level, source fingerprint, anonymization policy and field list; omit reverse mapping and raw source identifiers.
- [ ] Generate `BPlus-评委演示脚本.md` with a short 05→01→02→03→04 demonstration path.

## Task 7: Repack and verify
- [ ] Rebuild five importable workflow ZIPs from the user’s latest R3 exports, preserving workbook headers and current Workflow IDs.
- [ ] Validate every JSON reference target exists, every LogicEvaluator branch is connected, all Widget IDs match the current real bindings, and no raw privacy labels leak through Widget-facing outputs/example queries.
- [ ] Run ZIP round-trip, JSON parse, XLSX header, required primitive, action distinctness and privacy scans.
- [ ] Package all five ZIPs + workbook + manifest + demo script into `CampusFlow-ADP-BPlus-Test-Pack.zip` and publish SHA256.
