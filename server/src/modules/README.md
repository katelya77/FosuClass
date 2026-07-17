# Backend domain modules

Progressive modularization of `routes/admin.js` without duplicating business logic.

## Layout

```text
server/src/modules/<domain>/
  routes.js        # Express router for domain paths
  controller.js    # Optional request/response adapters
  service.js       # Domain logic (or re-export existing services)
  repository.js    # Persistence adapters
  schema.js        # Request/response contracts
  errors.js
  tests/
```

## Rules

1. Keep `/api/admin/*` paths and response shapes compatible.
2. Do **not** copy business implementations into two places.
3. Prefer moving handlers domain-by-domain; leave stable code in `admin.js` until extracted.
4. Tier 3 modules must fail open relative to Tier 0.

## Current extractions

| Domain | Status |
|--------|--------|
| auth | routes re-export login/logout/session helpers via shared service |
| audit | thin router mounting audit-log read API |
| dashboard | thin status aggregation adapter |

## Phase A inventory target modules

See `docs/admin-migration/feature-matrix.json` `targetModules`:

```text
auth, dashboard, catalog, sync, staging, release, runtime,
term, quality, content, feedback, campus-map, assistant,
provider, security, settings, audit, backups, jobs, relay
```

Extract handlers domain-by-domain in Phases B–D. Do not duplicate business logic into Vue-only handlers.
