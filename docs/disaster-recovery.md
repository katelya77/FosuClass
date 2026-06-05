# Disaster Recovery

## Publish Job Failed

1. Open the job details.
2. Check the sanitized error summary.
3. Run status reconcile.
4. Retry publish only if staging safety still passes.

## Worker Hung

1. Check release-heavy running job.
2. If stale, let stale-job recovery mark it failed.
3. Do not start a second release-heavy task manually.

## OpenResty Directory Not Writable

1. Fix ownership or mount permissions.
2. Run static sync again.
3. Verify `manifest.json`, `index/class/all.json`, and `empty-room/index.json`.

## Disk Critical

1. Run storage scan.
2. Preview safe cleanup.
3. Execute safe cleanup.
4. Retry release-heavy tasks after disk leaves critical state.

## Active Release Damaged

1. Roll back from Release history to last-known-good.
2. Run OpenResty static sync.
3. Verify static URLs.
4. Reconcile staging/upload status.

## Staging Status Inconsistent

Use "重新核对状态". The reconcile process compares active Release canonical hash, latest staging canonical hash, upload IDs, Relay IDs, and release versions. It is idempotent.
