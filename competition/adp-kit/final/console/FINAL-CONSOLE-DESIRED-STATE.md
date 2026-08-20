# Final Console Desired State

## User-confirmed truth (2026-08-20 after 21:03)

- Application: `校园智序 · 小序`
- Agents: 4; all models `DeepSeek-V3-0324`
- Main CampusTools: 0
- Unique CampusTools: 13
- Child bindings: 14 (`campus_academic_context` is intentionally bound to two Children)
- User Widget: `小序-校园智序结果卡`
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

## Multimodal status

Existing visual contracts remain future-ready, but no image capability is required by the Final text runtime or the four Final prompts. Missing visual binding must not affect normal tasks.

## Evidence boundary

The 20:30 application ZIP is historical structure only. Its old models, empty description, old greeting/questions, workflow names, retrieval switches, and stale data-version metadata are never applied to Console.

ADP API snapshot status for this run: `BLOCKED_UNKNOWN` (read failed without exposing credentials). Therefore this document records user-confirmed truth, not an API-observed claim.
