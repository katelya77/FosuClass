# Admin Modernization History

Status: **Superseded — Legacy-only admin retained.**

## Honest status

独立 Vue SPA 已下线。今后只维护 Legacy `/admin/*`；共享 API、Service、Repository、安全与并发控制继续保留。

| Area | Status |
|------|--------|
| Legacy-only routing | done |
| Historical alias redirects | done |
| Scoped service tokens (default deny) | done |
| Config migration-safe | done |
| Active vs Published UI | done |
| Vue SPA | removed |

## Generated artifacts

- `output/legacy-sync-compact/**`
- `server/storage/relay/**` runtime JSON
- `server/storage/staging-uploads/**` runtime JSON
- `server/data/backups/**` runtime dumps
