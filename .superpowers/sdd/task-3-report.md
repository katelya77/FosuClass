# Task 3 Report: Quality Ignore Contract and Async Recheck

## RED evidence

1. `npm run test:admin-c1-modules` failed because
   `quality.buildQualityReport` did not exist after the new-format ignore,
   recovery, stale-CAS, and legacy-array assertions were added.
2. `npm run test:admin-c1-http` failed with `404 !== 202` for
   `POST /api/admin/quality/recheck/start` before the route/job adapter.
3. The injected failure assertion then failed with `success !== failed` before
   the test-only harness failure boundary was implemented.
4. The metadata and legacy alias assertions each failed before the report
   partition returned rule metadata and `{stats, anomalies}` compatibility
   aliases.

## Implementation

- `modules/quality/repository.js` solely owns the ignore document: legacy-array
  reads, version calculation, prepare/commit CAS, and atomic replacement.
- `reportService.buildQualityReport()` reads the three legacy report sources
  once, assigns the canonical `${type}::${target}` fingerprint, partitions
  `active` and `ignored`, and returns compact summary counters plus legacy
  read-only aliases.
- `modules/quality/service.js` is a facade over repository/report services and
  creates `quality-recheck` singleton jobs through `jobService` only.
- The admin routes preserve the Task 2 prepared mutation -> backup -> commit ->
  audit transaction, expose the canonical report, and add recheck start/status
  endpoints. Recheck creation alone is audited; polling is not.

## GREEN verification

All commands completed with exit code 0:

```text
npm run test:admin-c1-modules
npm run test:admin-c1-http
npm run test:tier3-failure-isolation
npm run test:admin-backup-transaction
git diff --check
```

## Boundary review

- `server/src/routes/admin.js` has no direct ignore-file I/O.
- Quality modules have no release worker/publish, runtime-pointer, term,
  static-sync, child-process, or timetable-source writer imports/calls.
- The rollout manifest was not changed: Legacy remains primary, Next remains
  enabled, and Quality production writes remain disabled.

## Concern

The existing test environment still emits its unrelated `PORT=0` configuration
warning and npm's `electron_mirror` deprecation warning. Neither affects test
exit status or the quality implementation.
