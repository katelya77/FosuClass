# FosuClass public history purge plan

Status: **NOT EXECUTED**

This plan exists because production snapshots, generated backups and local capture derivatives remain reachable in Git history even after HEAD sanitization. It does not assert that a live credential was found.

## Reachable path groups

| Path group | First known commit | Reason |
| --- | --- | --- |
| `docs/captures/` except `.gitkeep` | `3860a68a5d9f7a5916f3504f9527203ecb83ccec` | Local HAR derivatives and a parsed personal schedule fixture do not belong in a long-lived public tree. |
| `server/data/backups/` | `d9e7b190f51595f7a9ad1939c5f89b163849af6b` | Generated runtime backups must remain outside source control. |
| `server/storage/snapshots/` | `9dfd89b47282605c892d8bc6f5b6c1d3112de233` | Full production schedule snapshots are runtime artifacts, not public source fixtures. |

## Preconditions

1. Keep a verified local `git clone --mirror` backup outside the working repository.
2. Confirm collaborators have no unpushed work based on the old history.
3. Confirm PR #49 will be rebased/recreated and its existing commit links will change.
4. Confirm all credentials separately identified by a secret scan have been revoked or rotated. The current scan did not justify automatic rotation.

## Proposed isolated mirror operation

Run only after explicit approval, in the disposable mirror clone—not in the working repository:

```powershell
git filter-repo --force --invert-paths `
  --path docs/captures/fosu_har_api_report.md `
  --path docs/captures/fosu_har_endpoint_summary.json `
  --path docs/captures/personal-schedule.parsed.json `
  --path docs/captures/third-party-bnsk-analysis.md `
  --path server/data/backups `
  --path server/storage/snapshots
```

Then rerun `npm run security:public`, inspect every branch and tag, compare retained refs against the mirror backup, and only then coordinate an explicit force-push window. No history rewrite or force-push is authorized by this plan.
