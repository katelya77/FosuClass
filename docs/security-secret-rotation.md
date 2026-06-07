# Security secret rotation

## Session token secret

1. Set `FOSU_SESSION_SECRET_PREVIOUS` to the old current value.
2. Set `FOSU_SESSION_SECRET_CURRENT` to the new value.
3. Change `FOSU_SESSION_SECRET_KID`.
4. Deploy.
5. Wait longer than `FOSU_SESSION_TTL_SECONDS`.
6. Remove `FOSU_SESSION_SECRET_PREVIOUS`.
7. Deploy again.

## Static ticket secret

1. Set `FOSU_STATIC_TICKET_SECRET_PREVIOUS` to the old current value.
2. Set `FOSU_STATIC_TICKET_SECRET_CURRENT` to the new value.
3. Change `FOSU_STATIC_TICKET_SECRET_KID`.
4. Deploy.
5. Wait longer than `FOSU_STATIC_TICKET_TTL_SECONDS`.
6. Remove `FOSU_STATIC_TICKET_SECRET_PREVIOUS`.
7. Deploy again.

## Rules

Do not reuse `ADMIN_API_TOKEN` as a session or static ticket secret.

Do not echo secret values in GitHub Actions logs.

In production, `session` and `ticket` modes must fail deployment validation if required secrets are missing. `observe` may start with warnings so last-known-good remains available.
