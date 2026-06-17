# Scope Audit

Time: 2026-06-17 16:17:34 +0800

## Required Start Checks

- `git pull origin main`: already up to date.
- `git status`: clean working tree on `main`.
- `git show --stat f7488df50b1adb4dc4bb7c749e4bd027aac3c8a9`: commit only changed:
  - `miniprogram/utils/storage.js`
  - `tools/test-current-schedule-refresh.js`
- Therefore the previous commit did not modify:
  - `miniprogram/pages/campus-map/*`
  - `miniprogram/pages/ai-assistant/*`
  - `server/src/services/ai/weatherService.js`
  - `miniprogram/pages/school/*`
  - `miniprogram/pages/today/*`
- Backup branch created at current `main`: `codex/backup-ui-map-weather-school-20260617-161734`.

## Current Campus Map Page Structure

- Page files: `miniprogram/pages/campus-map/campus-map.js`, `.wxml`, `.wxss`.
- Data source: `miniprogram/data/campusPlaces.js`.
- Campus tabs are defined in JS as `江湾`, `仙溪`, `河滨`, in that order.
- Top tabs are native `button` elements inside `.campus-tabs`.
- `.campus-tabs` uses CSS grid, but lacks `minmax(0, 1fr)`, explicit `width: 100%`, child `min-width: 0`, and full native button reset.
- Xianxi area row is shown only when `activeCampus === "xianxi"`, with `北区` and `南区`.
- Map preview calls `wx.previewImage` with five URLs, so the native viewer can show `1/5`, `2/5`, `3/5`.
- Map marker is generated from `mapRegion` without checking `verified`; unverified places can still display precise red boxes.
- Image loading failure only shows text, with no retry action and no custom fallback preview layer.

## Current Xiaofo Top Structure

- Page files: `miniprogram/pages/ai-assistant/ai-assistant.js`, `.wxml`, `.wxss`.
- Header is a single `.xiaofu-header` row with avatar, title, `headerSubtitle`, help `?` button, and a persistent `清空` button.
- Long subtitle remains visible in the top bar and competes with the title/buttons on small screens.
- There is no "more" menu for clear history; `clearHistory` is directly bound to the top button.
- Help and clear controls have different visual weight and size.
- Evidence/safety label logic defaults many tool-grounded responses to `已核验课表数据`, including weather.

## Current Weather Service Implementation

- Server file: `server/src/services/ai/weatherService.js`.
- Uses Open-Meteo through `axios.get`.
- Cache TTL defaults to about 10 minutes via `DEFAULT_TTL_MS`.
- Configured campuses: `仙溪校区` and `江湾校区`.
- `normalizeCampus` maps `江湾` to Jiangwan and everything else to Xianxi.
- No explicit `河滨校区` unsupported result; non-Jiangwan inputs can silently become Xianxi.
- Returned fields are limited to temperature, humidity, precipitation, wind speed, weather code/text, alerts, summary, `updatedAt`, and `cached`.
- No stale-last-success cache, no singleflight map, no apparent-temperature/current high-low/future six-hour compact fields.

## Current Weather Card Rendering

- Server mock provider builds weather as `type: "generic"` with title `校区天气`.
- `generatedPayloadContract` only allows generic/schedule/course/etc. card types, not `weather`.
- AI assistant WXML renders all cards through the generic `.ai-result-card` list/card structure.
- No dedicated weather card WXML/WXSS exists.

## Current School Search Loading

- Page files: `miniprogram/pages/school/school.js`, `.wxml`, `.wxss`.
- The page has `_schoolResultStore` and `_schoolResultVisible` non-responsive stores.
- Initial render size is `SCHOOL_RESULT_PAGE_SIZE = 30`; append step is also `30`.
- `onReachBottom` calls `loadMoreActiveResults`.
- WXML has manual "加载更多" rows, but no per-list state for loading/all-loaded/failed.
- Teacher/classroom/course tabs show empty guidance when there is no keyword; they do not intentionally render hundreds of items by default.
- Input debounce is 350ms, not about 300ms.
- Network request sequence guards exist in `executeSearch`, but pagination and cached render do not expose explicit stale-query state to the UI.

## Current Classroom Search Filtering

- `searchClassroomSchedule` sends the raw keyword to the search index and directly renders returned `data.items`.
- There is no classroom-specific query parser for C7/C5/building/exact-room/text.
- Building-code searches can inherit generic index fuzzy matches from names, ids, descriptions, courses, or other fields.
- Natural numeric sorting is not implemented for classroom search results.
- Map-to-school linkage opens `/pages/school/school?type=classroom&q=...`, but the school page does not currently provide a return link to the selected map position.

## Planned Modified Files

- `miniprogram/pages/campus-map/campus-map.js`
- `miniprogram/pages/campus-map/campus-map.wxml`
- `miniprogram/pages/campus-map/campus-map.wxss`
- `miniprogram/data/campusPlaces.js`
- `miniprogram/pages/ai-assistant/ai-assistant.js`
- `miniprogram/pages/ai-assistant/ai-assistant.wxml`
- `miniprogram/pages/ai-assistant/ai-assistant.wxss`
- `server/src/services/ai/weatherService.js`
- `server/src/services/ai/toolRegistry.js`
- `server/src/services/ai/providers/mockProvider.js`
- `server/src/services/ai/generatedPayloadContract.js`
- `miniprogram/pages/school/school.js`
- `miniprogram/pages/school/school.wxml`
- `miniprogram/pages/school/school.wxss`
- `miniprogram/pages/today/today.js`
- `miniprogram/pages/today/today.wxml`
- `miniprogram/pages/today/today.wxss`
- `miniprogram/pages/settings/settings.js`
- `miniprogram/pages/settings/settings.wxml`
- `tools/campus-map-editor/*`
- `package.json`
- New/updated tests under `tools/test-*campus*`, `tools/test-*weather*`, `tools/test-*classroom-search*`, `tools/test-*school-pagination*`, and AI UI/card tests.

## Explicit Non-Scope Areas

This round will not modify current schedule storage/migration, Publisher scripts, all-school crawler/sync/publish pipelines, active pointer cutover, or CloudBase release upload paths.
