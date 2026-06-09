# New Semester Release Playbook

Do not activate a future semester until the administrator has entered the confirmed start date and a healthy release exists.

## 1. Create The Term

In Admin Console, open `学期管理` and create a planned term:

- `term`: `2026-2027-1`
- `semesterText`: leave empty to auto-generate
- `termStartDate`: administrator-confirmed date
- `totalWeeks`: administrator-confirmed total weeks
- `weekStart`: `monday`

The new term remains `planned` and unavailable to normal queries until data is published.

## 2. Collect Data

Run the sync CLI with explicit term config:

```bash
npm run sync:local-campus -- \
  --term=2026-2027-1 \
  --term-start-date=2026-09-07 \
  --total-weeks=20 \
  --fresh
```

The date above is an example only. The CLI must not guess future semester dates.

## 3. Upload And Review

Upload staging JSON through the existing staging upload flow. The staging JSON must include top-level `termConfig`; sidecar metadata includes `term` and a `termConfigHash`.

Review counts, hashes, warnings, and term consistency in Admin Console. New semester staging must not overwrite current-term catalog files.

## 4. Build And Bind Release

Publishing a non-current term builds a term-aware release and marks the target term `ready`. It does not update `releases/active.json`.

The pre-switch check verifies:

- staging term
- snapshot term
- catalog term
- resources term
- manifest `termConfig`
- registry term
- release pack health
- OpenResty static manifest

## 5. Activate

Use `学期管理` to run readiness, then activate. The confirmation dialog shows old term, new term, releaseVersion, term start date, total weeks, counts, OpenResty status, and rollback target.

Activation updates registry, term-index, active.json, current snapshot, app-config, and static release pointers. On failure, the previous active state is restored.
