# Admin token & config migration

## Goal

Production should use an **independent** `ADMIN_API_TOKEN` that is not derived from `ADMIN_PASSWORD`.

## Default behavior (migration-safe)

- Startup runs config validation.
- Password-derived `ADMIN_API_TOKEN` emits a **HIGH** warning and continues.
- Process exits only when `FOSU_CONFIG_HARD_FAIL=true` and validation errors remain.
- Tokens are **never** printed by logs or `npm run config:preflight`.

## Steps

1. Generate a long random token offline.
2. Set `ADMIN_API_TOKEN` on the server (and in deploy secrets).
3. Update publisher/sync clients to the new token.
4. Run `npm run config:preflight` and confirm `derivedAdminApiToken: false`.
5. Optionally set `FOSU_CONFIG_HARD_FAIL=true` to prevent regressions.

## Admin SPA paths

| Flag | `/admin` | `/admin-next` | `/admin-legacy` |
|------|----------|---------------|-----------------|
| default (`FOSU_ADMIN_PRIMARY=legacy`) | Legacy console (production main) | Vue SPA | Legacy mirror |
| `FOSU_ADMIN_PRIMARY=next` | Vue SPA | Vue SPA | Legacy console |

Vue SPA first phase is a **read-only operations view**. Full write paths still live in Legacy.

## Related commands

```bash
npm run config:preflight
npm run test:config-migration-safe
```
