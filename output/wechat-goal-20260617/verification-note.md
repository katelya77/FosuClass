# WeChat DevTools Verification

- Project opened from repository root with AppID `wx450dc86653f5907b`.
- Simulator: iPhone 12/13 Pro, `windowWidth=390`, SDK `3.16.1`.
- Valid screenshots:
  - `ai-assistant.png`
  - `empty-room.png`
- Campus map page was opened in DevTools and DOM verified through `campus-map-report.json`.
  The DevTools `App.captureScreenshot` API hung on this page after the map route loaded, so no campus map PNG is included.
  The report confirms the search input and explicit search button are both present in one row.
