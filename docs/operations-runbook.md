# FosuClass Operations Runbook

## Long-Term Production Flow

1. Run a fresh local campus-network collection.
2. Upload staging data through CLI chunk upload or Relay.
3. Check the canonical hash in the admin sync center.
4. Publish the current staging package.
5. Let the Release Worker build the Release Pack.
6. Sync the active Release to the OpenResty static directory.
7. Verify the static URLs for `manifest.json`, `index/class/all.json`, and `empty-room/index.json`.
8. Confirm the mini program is using the active Release version.
9. Daily operation normally needs no manual cleanup.
10. On abnormal state, reconcile status first, then roll back only through Release history.

## Daily Checks

- Admin sync center shows active release, active canonical hash, and staging hash.
- Staging upload list does not show a publish action for data already published and active.
- OpenResty card shows enabled/configured/writable/version/URL states separately.
- Runtime and storage card shows disk not in critical state.
- Recent release-heavy jobs are success or intentionally failed with an error summary.

## Common Failures

- Publish job failed: inspect job logs, run status reconcile, then retry only if staging safety still passes.
- API restarted: `/api/admin/sync/status` runs lightweight reconcile and should restore upload status from files.
- Worker stuck: release-heavy lock prevents duplicate work; stale job recovery marks expired jobs failed.
- OpenResty directory not writable: fix directory ownership, then run static sync again.
- Disk space insufficient: run storage scan, preview cleanup, then execute safe cleanup.
- Active Release damaged: use Release history rollback to last-known-good.
- Staging status inconsistent: press "重新核对状态"; it compares active manifest and upload canonical hashes.
- CDN or Cloudflare 504: verify origin static URLs first, then purge or bypass CDN cache for the affected path.
- Sanitized logs: use admin audit logs and job logs; secrets, cookies, tokens, and local paths must be redacted.

## VPS Commands

```bash
cd /home/ubuntu/FosuClass
npm --prefix server install
NODE_ENV=production npm --prefix server start
```

After deployment, run from the admin sync center:

- `重新核对状态`
- `运行存储扫描`
- `验证静态 URL`
- `同步当前 Release` when OpenResty reports a version mismatch

## Rollback

Use the admin Release history module. Do not delete the active Release directory manually. After rollback, run static sync and URL verification so OpenResty and the mini program point at the same Release.
