# Grok Admin Modernization Progress

Branch: `grok/admin-modernization`

## Honest status

**Vue 后台 = 第一阶段只读运营台（read-only ops views）。**  
**Legacy `/admin` 是唯一权威写操作后台（默认生产主后台）。**  
**完整写路径仍在迁移，不得声称“完整迁移完成”。**

| Area | Status |
|------|--------|
| Dual-base SPA routing | done |
| Scoped service tokens (default deny) | done |
| Config migration-safe | done |
| Active vs Published UI | done |
| Playwright + CI | in progress until Actions green |
| Full write UX on Vue | **not done** |

## Flags

- Default: `FOSU_ADMIN_PRIMARY=legacy`
- Cutover candidate: `FOSU_ADMIN_PRIMARY=next` **and** `FOSU_ADMIN_NEXT_ENABLED=true`
- Conflict: `PRIMARY=next` + `NEXT_ENABLED=false` → effective **legacy** + warning

## Do not commit

- `output/admin-modernization-browser/**`
- `server/storage/relay/**` runtime JSON
- `server/storage/staging-uploads/**` runtime JSON
- `server/data/backups/**` runtime dumps
