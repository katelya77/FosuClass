# Admin migration (Legacy → Vue `admin-next`)

## Status

| Item | Value |
|------|-------|
| Phase | A (inventory + contracts + CI guards) |
| Production primary | `legacy` (`FOSU_ADMIN_PRIMARY=legacy`) |
| Parallel Vue entry | `/admin-next` |
| Legacy emergency | `/admin-legacy` (when primary=next) |

## Artifacts

| File | Purpose |
|------|---------|
| [legacy-feature-inventory.md](./legacy-feature-inventory.md) | Human-readable inventory and roadmap |
| [feature-matrix.json](./feature-matrix.json) | Machine-readable feature parity matrix |
| [api-contracts.json](./api-contracts.json) | Method / body / response / error-code contracts |
| [risk-register.md](./risk-register.md) | P0–P3 risks and mitigations |

## Commands

```bash
npm run admin:feature-matrix:generate
npm run test:admin-feature-matrix
npm run test:admin-legacy-dependency
npm run test:architecture-guards
```

## Rules

1. One business implementation shared by Legacy UI and Vue UI (Domain Service).
2. Do not grow `admin.js` / `adminPages.js` past architecture hard ceilings.
3. Do not flip production primary until Phase E gates pass.
4. Do not delete Legacy until Phase F stability evidence exists.
5. Never auto-activate Active Pointer / publish unauthorized releases in CI smoke.

## Phases

```text
A inventory → B CRUD writes → C system modules → D control plane → E cutover → F remove Legacy
```
