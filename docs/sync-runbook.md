# FosuClass sync operations runbook

## Boundary

`100.fosu.edu.cn` is only reachable from the campus network or a local campus
VPN such as EasyConnect. Do not turn the overseas VPS into a crawler and do not
install VPN on the VPS. The VPS receives staging data, validates it, builds
immutable releases, updates runtime pointers, syncs OpenResty static files, and
serves clients.

## Legacy command audit

| Legacy command | Accesses 100 net | Dynamic cache risk | Upload / publish |
|---|---:|---:|---|
| `sync:catalog` | yes | no | uploads catalog |
| `sync:majors` | yes | no, but read old `last-catalog.json` | uploads majors |
| `sync:class` | yes | progress, no-schedule, latest could participate | uploads class chunks |
| `sync:teachers` | direct only when explicitly requested | derived from class latest by default | uploads resources |
| `sync:classrooms` | no direct local crawler before this work | derived from class latest | uploads resources |
| `sync:courses` | no direct local crawler before this work | derived from class latest | uploads resources |
| `sync:resources` | teacher direct optional | read class latest/resources | uploads resources |
| `sync:release` | online by default, offline optional | class crawl was not strictly fresh | uploads and activates |
| `sync:fresh` | yes | name did not guarantee all fresh flags | uploads and activates |
| `sync:quick` | yes | reused catalog/majors and class could read old cache | uploads and activates |
| `sync:all` | yes | class progress/no-schedule/latest could participate | uploads, no release |
| `sync:upload-cache` / `local-upload` | no | explicit local cache/file | uploads, no crawl |

The risky cross-term files were `last-catalog.json`, `last-majors.json`,
`.debug/sync-progress.json`, `.debug/no-schedule-majors.json`,
`.debug/class-schedules-latest.json`, `.debug/resources-latest.json`, and old
resource fallbacks.

## New command matrix

| Command | Accesses 100 net | Uses catalog cache | Uses dynamic cache | Upload | Publish | Activate |
|---|---:|---:|---:|---:|---:|---:|
| `npm run sync:daily -- --term=...` | yes | reuse validated | no | yes | yes | yes |
| `npm run sync:daily:classes -- --term=...` | yes | reuse validated | no | yes | yes | yes |
| `npm run sync:daily:teachers -- --term=...` | yes | reuse validated | no | yes | yes | yes |
| `npm run sync:daily:classrooms -- --term=...` | yes | reuse validated | no | yes | yes | yes |
| `npm run sync:daily:courses -- --term=...` | yes | reuse validated | no | yes | yes | yes |
| `npm run sync:scopes -- --term=... --include=...` | yes | plan controlled | no by default | yes | yes | yes by default |
| `npm run sync:new-term -- --term=... --term-start-date=... --total-weeks=...` | yes | no | no | yes | yes | no by default |
| `npm run crawl:daily -- --term=...` | yes | plan controlled | no | no | no | no |
| `npm run crawl:scopes -- --term=... --include=...` | yes | plan controlled | no | no | no | no |
| `npm run sync:upload-staging -- --file=... --term=...` | no | file metadata | explicit only | yes | optional server flow | optional server flow |
| `npm run sync:resume -- --run-id=...` | per original task | per original task | only run progress | per original task | per original task | per original task |

## Daily production flow

Run on the local campus-network machine:

```powershell
cd C:\Users\Katelya\Documents\VScode\FosuClass
npm run sync:daily -- --term=2025-2026-2
```

The resolved `SyncPlan` must show:

```json
{
  "catalogPolicy": "reuse-validated",
  "schedulePolicy": "network-only",
  "progressPolicy": "ignore",
  "negativeCachePolicy": "ignore",
  "mergeOldData": false
}
```

Then the system performs:

1. Local crawl from `100.fosu.edu.cn`.
2. Per-term, per-run cache isolation.
3. Data quality gates and source provenance checks.
4. Staging sidecar metadata generation.
5. Chunked upload and server finalize.
6. Immutable release build.
7. Static mirror build and OpenResty sync.
8. Readiness check.
9. Atomic active pointer switch.
10. Client probe for runtime pointer, manifest, class/teacher/classroom/course indexes, calendar, and empty-room.

If any stage fails, no new active release is selected and the old online release
remains available.

## New-term production flow

```powershell
npm run sync:new-term -- --term=2026-2027-1 --term-start-date=2026-09-07 --total-weeks=20 --week-start=monday
```

Rules:

- term format must be `YYYY-YYYY-1|2`.
- start date and total weeks are mandatory.
- future terms are not activated unless `--activate` is passed.
- old-term catalog, majors, schedules, progress, and negative cache are not read.
- readiness must pass before activation.
- the old term release remains stored and rollback-capable.

## Upload-only flow

```powershell
npm run sync:upload-staging -- --file=.\staging\2025-2026-2-full.json --term=2025-2026-2
```

This command does not access the 100 net. It prints file path, term, hash, item
count, and whether the sidecar proves a fresh network crawl. If the sidecar does
not prove fresh network source, pass `--allow-cache-source` explicitly.

## Relay agent flow

Use Admin Sync Operations to create a relay task. The relay token can read one
task, report heartbeat/progress, upload candidate staging data, and be revoked or
cancelled. It cannot access `/api/admin/*`, publish releases, read administrator
settings, or transfer campus cookies/passwords.

When an agent is offline, the admin page shows copyable PowerShell commands
instead of pretending the VPS can crawl the 100 net.

## Client update

Versioned static release files stay immutable. `/static/runtime/active.json` is
no-store. The mini program checks the runtime pointer on launch and lightly on
foreground resume. A changed `releaseVersion`, `cacheEpoch`, or
`forceRefreshToken` triggers `switchReleaseSafely`; old cache remains
last-known-good until manifest, indexes, calendar, and empty-room data validate.

## 1Panel and OpenResty

No EasyConnect or campus VPN is required on 1Panel/VPS. A configuration change is
only needed if the existing OpenResty static release/runtime directories are not
mounted or the `OPENRESTY_STATIC_*` environment variables are missing.
