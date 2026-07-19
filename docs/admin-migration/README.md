# Admin migration history (Superseded)

Decision: Legacy-only admin retained. This directory preserves migration history; it is not an active Vue rollout plan.

## Status

| Item | Value |
|------|-------|
| Phase | Superseded |
| Production primary | Legacy-only `/admin/*` |
| Shared API rollout modules | `content,feedback,audit,backups` |
| Historical aliases | `/admin-next/*`, `/admin-legacy/*` → matching `/admin/*` |

## Artifacts

| File | Purpose |
|------|---------|
| [legacy-feature-inventory.md](./legacy-feature-inventory.md) | Human-readable inventory and roadmap |
| [api-contracts.json](./api-contracts.json) | Method / body / response / error-code contracts |
| [risk-register.md](./risk-register.md) | P0–P3 risks and mitigations |

## Commands

```bash
npm run test:admin-legacy-only
npm run test:architecture-guards
```

## Rules

1. Maintain one Legacy UI and one shared backend implementation (Domain Service).
2. Do not grow `admin.js` / `adminPages.js` past architecture hard ceilings.
3. Keep historical aliases as redirects only; never reintroduce a second admin page.
4. Never auto-activate Active Pointer / publish unauthorized releases in CI smoke.

## Historical phases

```text
A inventory → B CRUD writes → C system modules → D control plane → E cutover → F remove Legacy
```
