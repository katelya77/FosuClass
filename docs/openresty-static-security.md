# OpenResty static Release security

Use `deploy/openresty/fosu-static-security.conf` as an include template inside the 1Panel site `server {}` block. Do not overwrite the full 1Panel server configuration.

## Capability check

Before enabling ticket mode, verify:

```bash
openresty -V 2>&1 | grep -E 'http_lua|auth_request'
openresty -t
```

If Lua HMAC modules are unavailable, keep `public` or `observe`, or use the documented `auth_request` fallback with short timeout and microcache. Do not route every static file body through Node.

## Modes

`public`: current compatible behavior.

`observe`: serve files, add observation headers, and collect logs.

`ticket`: require `X-Fosu-Static-Ticket` before serving static files.

## Enable order

1. Deploy API in `observe`.
2. Confirm `/api/admin/security/status`.
3. Install OpenResty include in `observe`.
4. Verify real miniprogram session bootstrap.
5. Verify ticket issue and static request with header.
6. Configure Cloudflare to avoid public caching protected responses.
7. Switch to `ticket`.

Rollback:

```env
FOSU_SECURITY_MODE=observe
FOSU_STATIC_ACCESS_MODE=public
FOSU_OPENRESTY_STATIC_SECURITY_MODE=public
```
