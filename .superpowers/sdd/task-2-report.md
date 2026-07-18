# Task 2 Report: Real Express C1 HTTP Write Contract

## RED evidence

The test was written first in `tools/test-admin-c1-http.js` and uses the real
`server/src/app.js` behind a single test-owned `http.createServer` listener.

1. `node tools/test-admin-c1-http.js` initially failed with
   `APP_IMPORT_LISTEN_FORBIDDEN` from `server/src/app.js`: importing the app
   immediately called `listen`.
2. After making the import side-effect-free, the real Settings service-token
   request returned `401` instead of the required scoped denial because
   `catalog:write`, `quality:write`, and `settings:write` were not valid
   service-token scopes.
3. After adding scopes, route mappings, and security-event parity, the real
   Settings missing-`If-Match` assertion failed with `settings 428 created a
   backup` (`1 !== 0`). This established the premature-backup defect before
   the prepared mutation implementation.

## GREEN verification

The final failure-propagating verification completed with exit code 0:

```text
npm run test:admin-c1-http
npm run test:admin-http-write-parity
npm run test:admin-auth-modes
npm run test:service-token-route-matrix
npm run test:admin-backup-transaction
npm run test:admin-capabilities
git diff --check
```

`test:admin-c1-http` covers Catalog, Quality, and Settings with real login
cookie, CSRF, full-app CORS plus admin-Origin validation, Next gate, scoped
service token, scope-denial security event redaction, `If-Match` 428/409,
invalid body, successful write, per-request audit/backup accounting,
recoverable backup preflight, and same-version concurrent writes.

## Implementation notes

- `app.js` now exports the Express handler without listening; `startServer()`
  retains CLI startup and its maintenance startup work.
- C1 scopes are explicit and `admin:full` remains compatible.
- Settings, Catalog, and Quality prepare/validate/CAS-check before a backup;
  commit rechecks the prepared version directly before atomic write.
- Backups use collision-resistant names. Quality has a restore adapter, and
  the C1 routes create a recoverable fallback snapshot even for a first write.
- The isolated harness sets all path/auth environment before any server import,
  removes only its uniquely-prefixed `os.tmpdir()` root, clears server caches,
  and restores environment on close. It never accesses repository storage/data.

## Concerns

- The requested `PORT=0` fixture is deliberately reported by the existing
  migration-safe startup validator as `PORT is invalid: 0`; imports remain
  non-fatal because the harness owns the actual ephemeral listener. The test
  assertions and all commands above still pass.
- Existing npm runs emit the local `electron_mirror` configuration deprecation
  warning; it is unrelated to this task.

## Independent-review fixes

### RED evidence

The review corrections also began with test changes only:

1. `node tools/test-admin-c1-http.js` failed with `import failure did not fail`.
   The harness had no injectable startup boundary and therefore no way to prove
   cleanup when import/listen failed before a handle was returned.
2. After the harness cleanup path was implemented, the same command reached
   the real Settings HTTP mutation and failed with `settings commit-time 409
   left a backup` (`1 !== 0`). The cached Settings service commit was patched
   only in the test process to perform an external write in the isolated
   storage file immediately before the real commit-time CAS recheck.

### Implementation and coverage

- Harness cleanup is one idempotent async function shared by startup failures
  and returned `close()`. It closes a partial listener, restores the Express
  prototype, clears `server/src` cache entries, restores every overridden env
  value, and removes only the guarded temporary root. Injected import and
  post-listen failures assert that none of those resources leak; a successful
  harness also calls `close()` twice to prove idempotence.
- `createBackup()` returns the exact file path. All three C1 routes use one
  `commitWithBackup()` transaction. A commit-time `409`/`CONFLICT` removes only
  that request's backup before rethrowing, while a non-conflict commit failure
  retains its recovery backup. Neither failure writes an audit record.
- The forced commit-time conflict and retained-recovery-backup assertions run
  through real HTTP for Settings, Catalog, and Quality. The existing
  same-version `Promise.all` assertion remains unchanged.

### GREEN evidence

The post-review failure-propagating run completed with exit code 0:

```text
npm run test:admin-c1-http
npm run test:admin-http-write-parity
npm run test:admin-auth-modes
npm run test:service-token-route-matrix
npm run test:admin-backup-transaction
npm run test:admin-capabilities
git diff --check
```
