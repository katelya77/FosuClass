# Oracle runtime persistence cutover

This host-local executor moves the existing container writable-layer `/app/data`
to `server/storage/runtime-data`, using the **same original image**, Compose
project and service. It neither installs the Sample candidate nor changes Active,
Staging, Release, collector switches, school credentials or the personal Agent.
Sample installation follows only after this stage restores a healthy API.

## Inputs and preparation

Run on the authorized Linux ARM64 host as root with Node.js 20+, Docker Compose
v2, `tar`, `flock`, and systemd. Keep the complete checkout/package so that
`deploy/oracle-sample/preflight.js`, the campus signature module and
`tools/oracle-sample/maintenance-admin.js` resolve. No Git history is needed.

Create one root-owned mode `0600` JSON config in a root-only directory:

```json
{
  "appDir": "/absolute/production-checkout",
  "runtimeDir": "/absolute/openresty/runtime",
  "prebackupDir": "/root/already-verified-precutover-snapshot",
  "pinnedMigrator": "/root/already-verified/migrate-runtime-data.pinned.js",
  "stateDir": "/root/new-runtime-cutover-generation",
  "maintenanceCredentialsFile": "/root/protected-admin.env",
  "windowSeconds": 900
}
```

`maintenanceCredentialsFile` is consumed only by host-local authenticated
requests; use the existing protected admin credential file, without putting its
contents in commands, logs or Git. The pinned migrator must have Git blob SHA
`f25b93d07f23e379b100c7171aca93817e6c9238`. The expected original OCI revision is
`a3dfd1989705f51c921f13883bcde1cce4502883`.

```sh
node deploy/oracle-runtime-cutover/execute.js prepare --config=/root/cutover.json
```

Preparation leaves production running. It verifies the existing archive against
its SHA256 sidecar, container/image identity, signed personal Broker health,
queue state, current release/index hashes and resolved Compose configuration. It
saves root-only Compose/environment copies and the original image archive, then
resolves the proposed Compose file again and accepts only the image lock,
`pull_policy=never`, and new data bind. It also verifies free space. The output
contains the concrete original container/image identity and approval digest.
Repeating `prepare` against a `PREPARED` generation checks that the baseline is
still live. Any completed/interrupted generation must be inspected or recovered,
not reused to export stale data.

An active job record is reported as `preparationBlocker=ORPHAN_RECONCILIATION_REQUIRED`.
Read-only Compose/image recovery preparation continues, but **`start` still runs
the unchanged strict inventory gate before any maintenance action**. An old
timestamp alone does not prove a task is orphaned. All other inventory failures
remain fatal. The fixed Sample preflight and operate tools are unchanged.

New preparation/maintenance generations also capture the **complete original
Staging bytes**, privately bound to the protected SHA. Startup lifecycle
reconciliation may change only the six root `meta` fields established by the
pinned source: `stagingUploadStatus`, `releaseStatus`,
`publishedReleaseVersion`, `publishedAt`, `active`, and `reconciledAt`. Each new
value must match the existing Active authority and actual execution time window.
Every other field, including hashes, schedule rows, sources, upload references,
counts, previous hashes and nested metadata, stays strictly equal. `reason` is
not a permitted Staging field. No runtime lifecycle source is modified.

**Review that concrete preparation result and obtain the maintenance-window
approval before starting.** The digest is an execution guard, not human approval.

## One detached maintenance run

```sh
node deploy/oracle-runtime-cutover/execute.js start --config=/root/cutover.json --approve=PREPARED_APPROVAL_DIGEST
node deploy/oracle-runtime-cutover/execute.js status --config=/root/cutover.json
```

`start` installs the boot recovery service and independent watchdog before
starting the systemd worker. The worker uses admin cookie/CSRF/Origin and audited
maintenance actions to pause **new** personal-job admission, and waits for the
queue to drain. It stops the original container gracefully, then invokes the
unchanged pinned migrator against that stopped container. The native migrator
creates one latest consistent data archive, verifies its extracted content and
every regular-file SHA256, and atomically installs the target. Empty directories
are preserved separately. The extracted production bootstrap verifies and binds
its receipt to that full migration manifest before any replacement can start.

Compose recreates only `fosu-api`, with no build, pull or dependency restart.
Acceptance checks the effective full Docker configuration, four binds, Docker
health, actual health/ready response bodies, production revision, signed Broker,
paused/idle queue and protected release/notice hashes. Post-start static data
still requires exact bytes; append-only audit paths require every captured prefix
byte. Existing mutable AI conversation/run/preference/reminder stores may evolve
normally; their counts are recorded separately. **All-file preservation is
proved while stopped**, before those normal writes begin. Admission is restored
to its prior state only after acceptance, then health is checked again.

Inspect root-only `state.json`, `baseline.json`, `migration.private.json`,
`directories.private.json`, `worker.private.log`, `recovery.private.log` and
`final-runtime-backup/` for detailed evidence. Do not publish their contents.
`PASS` is emitted only after this actual run; local fixture tests do not set it.

## Failure and recovery

The worker deadline is bounded by `windowSeconds` (120–1800 seconds). Its
`ExecStopPost` recovery and the independently enabled watchdog/boot service also
cover lost SSH, Ctrl+C, SIGKILL and reboot. Recovery is serialized by a kernel
`flock`. Recovery has its own 1200-second budget; systemd allows 1230 seconds
instead of killing it after a short stop timeout. `RECOVERY_BLOCKED` is retried
by the watchdog because transient Docker/health failures must not strand a
paused or stopped original container.

Before any replacement may have written, recovery unpauses/starts the original
container and restores admission. A copied target then becomes stale and cannot
be replayed in a later window. After durable switch intent, recovery uses the
**original program image plus current persistent data**. It never extracts or
copies a historical snapshot over newer writes. `original-image.tar` is solely
an image recovery artifact; `final-runtime-backup/` holds the distinct latest
data backup. Missing authority/markers or unsafe inputs retain the scene and
report `RECOVERY_BLOCKED`; they do not guess or delete unique source data.

If intervention is needed, the same recovery entrypoint is the shortest safe
action after examining the private failure code:

```sh
node deploy/oracle-runtime-cutover/execute.js recover --config=/root/cutover.json --force
```

A healthy successful generation is an idempotent no-op for recovery. After
terminal verification, its watchdog may be disabled by the operator; retain the
private configuration and data/image recovery artifacts for the next release.

## Independent read-only acceptance after safe recovery

When the persistent original-image container is already healthy, use this entry
instead of repeating a migration or container switch:

```sh
node deploy/oracle-runtime-cutover/execute.js accept --config=/root/cutover.json --business-evidence=/root/private-business-probes.json --source-evidence=/root/private-current-staging-source-proof.json
```

It rechecks the real image/container contract, data bind, archive and migration
fingerprints, bound bootstrap receipt, files/directories, health response bodies,
revision, signed personal Broker, restored admission and online Agent. It calls
the actual API again for the manifest, all four complete source indexes and
notice content, and compares them to the private business probe evidence. Notice
reactions are excluded only from that content comparison; all other notice
fields remain protected. The probe hash convention matches compact sorted
Python JSON with `ensure_ascii=True` and original array order. Optional source
evidence is bound by SHA and the real original upload SHA is checked again.
The recorded source-field comparison is explicitly **attached private evidence**,
not a claim that the helper recomputed a missing historical object.

The result is `readonly-acceptance.private.json` with schema
`oracle-runtime-persistence-acceptance.v1`, bound to the original state, baseline,
image, migration, markers and current captured Staging. The original transaction
phase remains `RECOVERED_PERSISTENT`; it is not rewritten as historical `PASS`.
If that generation recorded only an old Staging byte hash and no original JSON,
`historicalStagingUnchanged=PENDING` and `preStateObjectAvailable=false` remain
visible. Current runtime/data/health/business preservation can independently
pass without inventing the missing historical Staging metadata proof.
`staging.accepted.private.json` is a complete fresh baseline for the next
approved deployment, not a reconstruction of the previous one. Acceptance
performs no admission write, stop, Compose switch, data copy or publication.

## Independently approved orphan metadata recovery

The original job service ignores locks older than its configured stale interval
(default 30 minutes), but leaves their historical `running` metadata unchanged.
It does not redispatch those records on restart. There is no existing protected
job-recovery POST. The host-local helper therefore uses the original container's
native write guard, scope gate, job service and durable audit implementation,
without installing a new route or changing the pinned candidate:

```sh
node tools/oracle-sample/recover-orphan-job.js prepare --state-dir=/root/orphan-recovery-generation --job-id=EXACT_JOB_ID
```

Preparation verifies that the original healthy container is still running; the
target is precisely a `release-pack-rebuild`; its last update predates the current
container lifecycle and exceeds the native stale interval; the native release
lock is empty; and no exact worker argv binds to that job. It checks the entire
record SHA twice across 10 seconds, saves its complete original bytes and SHA in
root-only files, and generates an exact approval digest. Reviewer `node -e`
source text is never mistaken for a worker argv. Preparation changes no job,
release, admission or service state.

Show this specific orphan operation alongside the maintenance-window scope for
one human review. Its separate confirmation value must also be explicitly
approved; the maintenance digest alone cannot authorize metadata repair.

```sh
node tools/oracle-sample/recover-orphan-job.js apply --state-dir=/root/orphan-recovery-generation --job-id=EXACT_JOB_ID --credentials-file=/root/protected-admin.env --approveOrphan=MARK_ORPHAN_FAILED:PREPARED_ORPHAN_DIGEST
```

Apply obtains a real admin cookie/CSRF through the existing login/session API.
It sends those headers only over local Docker stdin, never command arguments or
saved logs. Original native `verifyAdminWriteAccess` and `requireScopes` validate
Origin, CSRF, session and `admin:full` again inside the original container. It
rechecks exact container/source pins, backup hash, lifecycle, worker/lock and
record SHA. A durable idempotent intent audit must succeed before native
`finishJobFailed` closes **only that job metadata**. The result audit must also
verify. Full input and original logs remain in the private byte-for-byte backup;
the native job update retains its ordinary payload and log discipline.

Interrupted completion-audit recovery authenticates again and completes the
same operation without rewriting the failed record. A changed live record or
missing authority blocks; no old record is copied over it. No worker is killed,
release rebuilt, admission changed, image replaced, school contacted or data
published. Status is available using `status` with the same state directory and
job ID. Then rerun ordinary P0 preparation; strict inventory must now truly pass.

## Local validation

```sh
node --test tools/test-oracle-runtime-cutover.js
node --test tools/test-oracle-orphan-job.js
node --test tools/test-oracle-persistence-acceptance.js
```

The fixture-only suite exercises the unchanged native migrator/archive and
bootstrap, same-size corruption, empty directories, unauthorized Compose
changes, live AI writes and audit tampering, interrupted-original recovery,
uncertain Compose completion, failed health and safe recovery retry. It never
uses Docker, production data, school access or credentials.

The additional orphan tests use the real local admin HTTP harness, native
cookie/CSRF guard, native job and audit modules; they verify exact process
matching, active/lifecycle/hash/approval rejection, audit write faults and safe
retry after a lost completion audit. These are fixture proofs, not production
metadata recovery evidence.
