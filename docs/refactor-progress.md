# Grok Admin Modernization Progress

Branch: `grok/admin-modernization`  
Baseline: `5d7eb469` (main)

## Honest status (2026-07-18)

**Vue 后台第一阶段只读运营视图完成。**  
**完整写路径仍在迁移。**  
**Legacy 是当前生产主后台**（默认 `FOSU_ADMIN_PRIMARY=legacy`）。

| Phase | Name | Status |
|------:|------|--------|
| 0–1 | Architecture + P0 security | completed |
| 2 | admin-web foundation | completed |
| 3 | Core read ops UI | completed (read-only) |
| 4 | Domain module boundaries | started (auth/audit/dashboard shells) |
| 5 | Remaining pages | partial — read views + legacy write links |
| 6 | Switchover readiness | dual-base + flags ready; **default not cut over** |

## Runtime paths

| Mount | spaBase | legacyBase |
|-------|---------|------------|
| `/admin-next/*` | `/admin-next/` | `/admin/` |
| `/admin/*` (primary SPA) | `/admin/` | `/admin-legacy/` |

## Flags

- `FOSU_ADMIN_PRIMARY=legacy` (default): production main = Legacy `/admin`
- `FOSU_ADMIN_PRIMARY=next`: SPA at `/admin`, Legacy at `/admin-legacy`
- `FOSU_CONFIG_HARD_FAIL=true`: only then hard-fail derived token in production

## Remaining write paths (still Legacy)

Sync publish/upload, Terms activate/repair, Content CRUD, Settings save, Assistant KB, Provider config, Backups delete, Campus map editor.
