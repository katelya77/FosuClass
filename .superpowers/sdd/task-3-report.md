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

## Independent-review follow-up

The review's four Important findings were fixed in a new commit (without
amending the original Task 3 commit).

### Additional RED evidence

1. The new HTTP seam test reached `success !== failed` before the runner used
   its code-only report-builder dependency; the former environment switch was
   no longer involved.
2. Module and real HTTP malformed-file tests demonstrated that malformed JSON
   was treated as an empty document (HTTP instead returned a CAS `409`), rather
   than a typed persistence failure with no backup/audit.
3. The absent-course-name fixture failed because the new detector generated
   `C2:` instead of the legacy `C2:undefined` target.
4. The rename-failure test showed the former replacement fallback could replace
   the live document instead of reporting a recoverable replacement error.

### Follow-up implementation

- `startQualityRecheck(input, { buildReport })` has an internal-only second
  dependency seam. Production always uses `buildQualityReport`; routes pass
  only request input. HTTP tests monkeypatch the cached facade to inject
  deferred and throwing builders. There is no recheck test environment switch
  or artificial delay in production code.
- Ignore reads now return empty only for `ENOENT`; malformed or unreadable
  documents raise `500 QUALITY_IGNORES_MALFORMED` without mutation, backup, or
  audit.
- Report target construction now mirrors legacy `undefined` interpolation and
  skips empty classroom names. The legacy generator is a thin compatibility
  wrapper over the canonical report service.
- Replacement uses write-temp then one rename only; a failed replacement cleans
  the temp file and raises `QUALITY_IGNORES_REPLACE_FAILED` without deleting or
  copying over the live document. Commit obtains a tokenized `wx` per-file lock,
  safely reclaims only stale dead-PID locks, rechecks CAS under that lock, and
  always releases it. The module test starts two real Node processes with the
  same prepared version and proves exactly one success and one `409 CONFLICT`.

## Second independent-review follow-up

### RED evidence

1. Injecting a lock-file descriptor write failure left the canonical `.lock`
   file behind, blocking the following mutation.
2. A fresh held lock returned `409 QUALITY_IGNORES_LOCK_TIMEOUT`, causing the
   generic backup cleanup to delete a recovery backup.

### Implementation and verification

- Initialization closes an acquired descriptor and discards its owned lock on
  write/close failure. Stale malformed locks are atomically retired when old;
  valid locks require a dead owner PID.
- Release verifies the token, retries unlink, then retires the canonical name;
  irrecoverable release errors are typed `QUALITY_IGNORES_LOCK_RELEASE_FAILED`.
- Lock timeout is `503`, and backup cleanup is now only `error.code ===
  "CONFLICT"`. Module injection covers lock write/unlink failures; real HTTP
  covers held-lock 503, no audit, recovery-backup retention, and later success.
- Fresh green: Task 3 module/HTTP/tier3 tests plus Task 2 HTTP parity, auth,
  route matrix, backup transaction, capabilities, and `git diff --check`.
