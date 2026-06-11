# FosuClass local sync client

`fosu-sync-client` is the only component that may crawl `100.fosu.edu.cn`.
Run it on a campus-network/VPN Windows machine. The VPS only receives staging
snapshots, validates them, builds immutable releases, switches runtime pointers,
and serves static files.

Do not store or commit cookies, passwords, JSESSIONID, CAS tickets, or raw
identity tokens. `.debug/` is for redacted diagnostics only.

## Recommended commands

Daily update:

```powershell
npm run sync:daily -- --term=2025-2026-2
```

New term:

```powershell
npm run sync:new-term -- --term=2026-2027-1 --term-start-date=2026-09-07 --total-weeks=20 --week-start=monday
```

Upload an explicit staging file:

```powershell
npm run sync:upload-staging -- --file=.\staging\2025-2026-2-full.json --term=2025-2026-2
```

Resume an interrupted run:

```powershell
npm run sync:resume -- --run-id=RUN_ID
```

## Command matrix

| Command | Accesses 100 net | Catalog cache | Dynamic cache | Upload | Publish | Activate |
|---|---:|---:|---:|---:|---:|---:|
| `sync:daily` | yes | reuse validated | no | yes | yes | yes |
| `sync:daily:classes` | yes | reuse validated | no | yes | yes | yes |
| `sync:daily:teachers` | yes | reuse validated | no | yes | yes | yes |
| `sync:daily:classrooms` | yes | reuse validated | no | yes | yes | yes |
| `sync:daily:courses` | yes | reuse validated | no | yes | yes | yes |
| `sync:scopes -- --include=...` | yes | plan controlled | no by default | yes | yes | yes by default |
| `sync:new-term` | yes | no | no | yes | yes | no by default |
| `crawl:daily` / `crawl:scopes` | yes | plan controlled | no | no | no | no |
| `sync:upload-staging` | no | file metadata | explicit only | yes | optional server flow | optional server flow |
| `sync:resume` | yes, per original task | per original task | only run progress | per original task | per original task | per original task |
| `sync:upload-cache` | no | explicit cache/file | yes, explicit | yes | no | no |

Legacy commands such as `sync:fresh`, `sync:quick`, `sync:all`, `sync:release`,
and `sync:resources` are preserved as deprecated wrappers. They print the
resolved `SyncPlan` and map to explicit new semantics. `upload-cache` never
accesses `100.fosu.edu.cn`.

## SyncPlan guarantees

Production crawl profiles (`daily`, `crawl`, `sync`, `fresh`) default to:

```json
{
  "schedulePolicy": "network-only",
  "progressPolicy": "ignore",
  "negativeCachePolicy": "ignore",
  "mergeOldData": false
}
```

That means a daily run does not use `latest.json`, old progress, no-schedule
negative cache, or old merged schedules to fake a fresh crawl. If a target scope
fails, the run fails by default and does not upload or activate a partial
snapshot. `--allow-partial` is diagnostic only; partial releases are blocked by
the server publish gate unless explicitly handled by an administrator.

## Cache layout

New cache files are isolated by term:

```text
tools/fosu-sync-client/.cache/
  2025-2026-2/
    catalog/
      catalog.json
      majors.json
      classes.json
      metadata.json
    schedules/
      class/latest.json
      teacher/latest.json
      classroom/latest.json
      course/latest.json
    progress/
      class/{runId}.json
      teacher/{runId}.json
      classroom/{runId}.json
      course/{runId}.json
    negative/
      no-class-schedule/{runId}.json
      no-teacher-schedule/{runId}.json
      no-classroom-schedule/{runId}.json
      no-course-schedule/{runId}.json
    staging/
      latest.json
      latest.meta.json
    reports/
      crawl-report-*.json
      upload-report-*.json
      publish-report-*.json
```

`.debug/` only stores redacted samples, raw diagnostic HTML, and troubleshooting
logs. Production reads should converge on `.cache/{term}`. Legacy debug files
may be imported once as last-known-good, but they are not a long-term read path.

Each cache metadata file records term, scope, source, acquisition mode, command,
runId, count, hash, session fingerprint, and freshness. It must not contain
cookie, password, session id, CAS ticket, student id, or token values.

## Source provenance

Every dynamic scope writes one of:

| Scope | Default source |
|---|---|
| `classSchedules` | `network-direct` from class schedule pages |
| `teacherSchedules` | `network-direct`; `daily:classes --allow-derived` records `derived-current-run` |
| `classroomSchedules` | `network-direct`; `daily:classes --allow-derived` records `derived-current-run` |
| `courseSchedules` | `network-direct`; `daily:classes --allow-derived` records `derived-current-run` |

When a resource-only command needs class data as a current-run target seed, the
plan adds `classSchedules` to the crawl. It must not silently read old dynamic
class cache.

## Daily flow

1. Build and print `SyncPlan`.
2. Reuse validated catalog/majors for the same term.
3. Crawl dynamic scopes from `100.fosu.edu.cn` with fresh runId isolation.
4. Ignore old progress and negative cache.
5. Validate counts, term, fields, source provenance, and partial state.
6. Write `.cache/{term}/schedules/*/latest.json` only after successful validation.
7. Generate staging snapshot and sidecar metadata.
8. Upload staging chunks.
9. Server finalizes, validates hash/count/source, builds immutable release.
10. Server builds static mirror, runs readiness, switches active pointer atomically.
11. OpenResty static sync and client probe verify manifest/index/calendar/empty-room.

If any stage fails, the old active release and last-known-good remain usable.

## New-term flow

`sync:new-term` requires explicit `--term-start-date` and `--total-weeks`. It
does not guess the first teaching day, does not reuse old-term catalog, majors,
schedules, progress, or negative cache, and does not activate by default.

Use `--activate` only after readiness passes and the administrator confirms the
future term should become current.
