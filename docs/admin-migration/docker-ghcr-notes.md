# Docker / GHCR notes (Phase B.1 + C0)

## Chromium decision

**Retain Chromium in the runtime image.**

- Production default: `FOSU_IMPORT_USE_PLAYWRIGHT_FALLBACK=false`
- Code path still loads `playwright-core` + system chromium when fallback is enabled
  (`server/src/services/fosuApaasImporter.js`, `FOSU_IMPORT_BROWSER_EXECUTABLE_PATH`)
- Removing Chromium without a full personal-import E2E on ARM64 would risk silent import failure when ops enables fallback
- Size optimization focuses on multi-stage build, `.dockerignore`, and omitting dev/test artifacts — not removing Chromium in this phase

## Image naming

```text
ghcr.io/katelya77/fosuclass-api
tags: sha-<full-commit>, main, latest
production deploy: immutable tag or digest only (never latest alone)
```

## Deploy modes

| `FOSU_DEPLOY_IMAGE_MODE` | Behavior |
|--------------------------|----------|
| `hybrid` (default) | Pull `ghcr.io/katelya77/fosuclass-api:sha-$COMMIT` if available; else `docker compose up --build` |
| `ghcr` | Require GHCR pull; fail if missing |
| `source` | Always local build |

## Rollback

State files under `server/.deploy/`:

- `current-image.txt`
- `previous-image.txt`
- `last-deploy.env`

On health/smoke failure, restore `PREVIOUS_IMAGE_REFERENCE` and `compose up --no-build`.

## Write modules (explicit)

Production deploy always sets:

```env
FOSU_ADMIN_NEXT_WRITE_MODULES=content,feedback,audit,backups
```

Unset/empty → no Vue write modules.
