# Manual ADP Actions

Only the following Console actions remain eligible. Do not publish the application.

## 1. Replace four instructions

- Page: Application → Multi-Agent → each Agent → Instructions
- Current value: post-21:03 user-edited instructions (exact hash not readable through API)
- Desired value: the matching file under `competition/adp-kit/final/prompts/`
- Verify: all four models still show `DeepSeek-V3-0324`; Main still has no CampusTools; Children retain the existing 14 bindings.

## 2. Update the existing unified Widget

- Page: Widget development → `小序-校园智序结果卡`
- Action: import/replace from `competition/adp-kit/final/widget/小序-校园智序结果卡.widget`
- Current value: real export ID `978b004b2f054e8bbd5438159c7329ff`
- Desired value: same ID/name, Final Temporal Campus OS View and v7 public contract
- Verify: preview all ten payloads in `final/acceptance/widget-payloads/`; buttons send only natural-language chat queries.

## 3. Verify application surface (no restoration from ZIP)

- Page: Application settings
- Verify description and greeting remain the user's Final copy.
- Verify exactly the three opening questions listed in `FINAL-CONSOLE-DESIRED-STATE.md`.
- Do not restore the old “输入功能示例” greeting or old questions.

## 4. Verify archives and knowledge

- Page: Workflows → verify exactly six retained historical workflows end in `-END` and are disabled; the node-format seed is absent.
- Page: Knowledge → TEST QA absent; Document ON; Rerank ON; QA/DB/Search OFF.
- Page: Variables/Plugin metadata → if legacy `data_version` exists and has no consumer, remove it; if the platform requires it, set it to the verified runtime truth `competition-demo-v3`. User-visible descriptions must not show this value.

## 5. Preview acceptance

- Open a new Preview session.
- Run A–P in `FINAL-ACCEPTANCE-MATRIX.md`, including at least one paraphrase per row.
- Confirm the combined schedule+risk task ends in a risk card and the soft-preference space task makes one business query.
- Save Preview evidence, but do not create a release and do not publish.

