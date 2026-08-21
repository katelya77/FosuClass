# Final Console Desired State

## User-confirmed truth (2026-08-21)

- Application: `校园智序 · 小序`
- Agents: 4; all models `DeepSeek-V3-0324`
- Main CampusTools: 0
- Unique CampusTools: 13
- Child bindings: 14 (`campus_academic_context` is intentionally bound to two Children)
- User Widget: `小序-校园智序结果卡`
- Current Widget ID: `601418106a374b2eb7de54c65a3de7e0`
- New keyboard and Widget `sys.chat` turns start at Main
- Transfer graph: Main → Schedule/Risk/Insight; each Child → Main only
- CampusTools direct result output: OFF for all 13 operations
- TEST QA: absent
- Node-format seed workflow: absent
- Historical workflows: exactly 6, names end in `-END`, all disabled
- Publish/release: forbidden

## Opening questions

1. 查看教师003第1周课表，并检查他的跨校区赶场风险
2. 帮教师005、教师006、教师014找第1周周四上午的共同空闲，并推荐合适教室
3. 未来四周教师负载最高的是谁？

## Retrieval

- Document Retrieval: ON
- Rerank: ON
- QA Retrieval: OFF
- DB Retrieval: OFF
- Search Retrieval: OFF

The current screenshots show QA and DB enabled. This is known drift and remains **MANUAL_REQUIRED**; recall count and threshold must not be changed without evaluation evidence.

## Multimodal status

Existing visual contracts remain future-ready, but no image capability is required by the Final text runtime or the four Final prompts. Missing visual binding must not affect normal tasks.

## Evidence boundary

The 20:30 application ZIP is historical structure only. Its old models, empty description, old greeting/questions, workflow names, retrieval switches, and stale data-version metadata are never applied to Console.

ADP API snapshot status for this run: `BLOCKED_UNKNOWN` (read failed without exposing credentials). Therefore this document records user-confirmed truth, not an API-observed claim.

## Final reliability contracts (REPO_FINAL, console-side verification)

- Data provenance & privacy truth: prompts and app copy must state the demo uses anonymized/desensitized
  teaching data mapped to the unified campus model; dynamic conclusions come from controlled verification;
  no real accounts/passwords/unauthorized personal data are read; no claim of connecting the school's
  official timetable system or reading personal courses. See `final/console/MANUAL-ADP-ACTIONS.md` §1a.
- Fail-safe presentation contract: widget renders normally where supported; if a result card cannot
  render, the readable Chinese text is derived from the same verified projection (never a bare
  placeholder, bare JSON, schema/version, or internal protocol). See
  `final/presentation/PRESENTATION-CONTRACT.md`.
- Final Hero Stability Matrix: 8 groups × ≥3 variants pass all five gates
  (`r49-ma/tests/test-final-hero-stability.js`).
