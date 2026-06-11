# New semester release playbook

## Lifecycle

The admin UI presents the lifecycle as:

`planned -> collecting -> staged -> ready -> current -> archived`

The backend keeps the existing compatible statuses (`planned`, `ready`,
`current`, `archived`, `disabled`), but operations should follow the lifecycle
above.

## Create or update planned term

Required fields:

- `term`, for example `2026-2027-1`
- `termStartDate`, confirmed by an administrator
- `totalWeeks`
- `weekStart`, normally `monday`

Never guess a future term start date.

## Collect data

Run from a campus-network/VPN local machine:

```powershell
npm run sync:new-term -- --term=2026-2027-1 --term-start-date=2026-09-07 --total-weeks=20 --week-start=monday
```

This command:

1. validates term format;
2. creates or updates a planned term;
3. crawls catalog, majors, classes, class schedules, and resource schedules;
4. generates teaching calendar metadata from explicit input;
5. uploads staging;
6. builds an immutable release;
7. runs readiness;
8. does not activate by default.

It must not reuse old-term catalog, majors, schedules, progress, no-schedule
cache, or derived release artifacts.

## Activate

Only activate after readiness passes:

```powershell
npm run sync:new-term -- --term=2026-2027-1 --term-start-date=2026-09-07 --total-weeks=20 --week-start=monday --activate
```

The admin page should show the old current term, new term, release version,
calendar count, source provenance, partial state, OpenResty status, and rollback
target before activation. Activation is atomic; failure restores the previous
active release and runtime pointer.

## Readiness categories

- blockers: unsafe to activate;
- auto-repairable: runtime pointer rebuild, static manifest regeneration,
  OpenResty sync, derived index rebuild, missing calendar metadata repair;
- warnings: freshness, unusually large diffs, non-blocking static warnings;
- info: counts, source modes, release version, calendar summary.

Unsafe auto fixes are forbidden: guessing start dates, activating future terms,
using another term's release, marking incomplete staging as ready, or filling a
new term with old dynamic cache.
