# FosuClass goal audit - 2026-06-17

Baseline: `origin/main` at `7c64628447d06e3f480a74adc777b91d2eb16e5e`.

Backup branch: `codex/backup-fosuclass-goal-20260617-205313`.

## Guardrails

- Do not modify schedule crawling, Publisher, Release Pack generation, or active release pointers.
- Do not run `sync:publish`, `sync:publish:*`, or any active release switch command.
- Public UI must not expose provider names, model names, competition mode, allowlists, backend topology, or prompts.
- API keys must remain backend-only, encrypted at rest, and redacted from logs and API responses.

## Xiaofu AI audit

Root causes:

- The header uses a flexible avatar/title/actions row. At narrow widths or larger system fonts, the title and status are two independent text nodes, so the center region can collapse, wrap, or be covered by the two action buttons.
- Quick actions, task panel items, welcome examples, and capability-guide examples are defined separately. Missing-slot examples fill text in some entry points but other public examples can be sent as invalid requests.
- The client context does not consistently send the mini-program `envVersion`, so the backend cannot reliably distinguish develop/trial/release when evaluating fail-closed external-model rules.
- Public responses currently hide provider metadata, but release-mode tests need an explicit `externalProviderUsed: false` contract instead of relying only on omission.

Design specification:

- Header becomes a stable three-column grid: avatar, single-line `小佛·在线` identity, and fixed-size help/more icon buttons. The center column uses `minmax(0, 1fr)`, no wrapping, and cannot be squeezed by the action column.
- The message list, composer, capability guide, header menu, privacy sheet, and task bottom sheet keep fixed safe-area spacing so overlays do not hide the active input or bottom actions.
- One capability registry becomes the source for all public entry points. Each capability is classified as direct deterministic tool, missing-parameter draft, page navigation, or generative Q&A. Complete deterministic tasks send immediately; incomplete tasks only seed the draft and ask for the missing slot.
- Public copy describes results as verified campus tools or local fallback only. It does not name providers, models, competition, allowlists, or prompts.

Implementation plan:

- Add the capability registry and route quick actions, task panel, guide examples, and welcome examples through one dispatcher.
- Add client `envVersion` to AI requests and harden server public/release response contracts.
- Extend admin AI status and verification with trial enhanced-mode status, authorization expiry display, a real provider probe, and a release block probe.

## Campus map audit

Root causes:

- `onSearchInput` calls `runSearch` on every keystroke.
- `runSearch` focuses the first result when there is no explicit selection, which switches map state and can show a red box without user intent.
- `onLoad` runs search from `q` and can focus from stale links. Existing action URLs include both `q` and `placeId`, making the page look preselected.
- There is a local map editor, but the web admin does not expose draft/published/history management for the map data used by both the mini program and Xiaofu tools.

Design specification:

- Normal open state is blank query, no selected building, no red box.
- Input only updates text. Search runs only through the search button or keyboard confirm.
- Search displays a result list, loading state, empty state, and error state; it never auto-selects the first result.
- A verified red box appears only after the user taps a concrete verified result.
- Admin map editing uses explicit campus/area selection, searchable place list, form editing, draggable/resizable rectangle, undo/redo, draft save, publish, rollback, import/export, and backup.

Implementation plan:

- Split query editing from search execution on the mini-program page.
- Remove default `q` behavior from normal map opening and remove `q` from AI map action URLs.
- Add a backend map repository with draft, published, history, backup, import, export, publish, and rollback operations.
- Make Xiaofu map tools read the same published map data, with legacy and package fallback.

## Empty room audit

Root causes:

- The page queries on load and every filter change, so the first screen is both dense and constantly reactive.
- Date, 14 sections, all buildings, favorites, continuous-section filters, and internal data-source wording are all visible on the first screen.
- Public copy exposes internal Release Pack/static-index/manifest language.
- Results are flat. Cards carry secondary operations that compete with the room, building, free period, continuous-free, and next-occupied facts.

Design specification:

- First screen contains only title, teaching week/date/update time, today/tomorrow/date selection, now/morning/afternoon/evening chips, current building summary, one primary `查询空教室` button, and `更多筛选`.
- Exact date, 1-14 sections, min continuous free sections, campus/building, common-only, favorites, and unknown-building toggles live in a scrollable bottom sheet with reset and confirm.
- Result groups are organized by building. Cards emphasize room name, building, free period, continuous free, and next occupied. Tapping the card opens details; copy moves to details/more action.
- Long result sets paginate at page bottom and keep last-known-good results when refresh fails.

Implementation plan:

- Stop automatic searches on load and filter mutation. Load metadata/index for freshness, then search only from the primary button.
- Move advanced filters into a bottom sheet and update summary text from selected filters.
- Group and paginate results by building while keeping the detail flow intact.
- Replace public internal wording with user-facing freshness and cache language.
