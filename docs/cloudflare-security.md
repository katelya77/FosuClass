# Cloudflare cache security

## Public mode

`FOSU_SECURITY_MODE=observe` with `FOSU_STATIC_ACCESS_MODE=public` may keep immutable public caching for `/static/releases/*`.

## Origin ticket mode

When OpenResty validates `X-Fosu-Static-Ticket` at origin, Cloudflare must not convert the first authorized response into an anonymous public cache hit.

Use one of these controls for protected paths:

- Bypass cache for `/static/releases/*` while ticket mode is enabled.
- Or cache only after an edge Worker verifies the same ticket and includes authorization state in the cache key.
- Never put the ticket in the URL query.
- Do not cache 401/403 responses for a long TTL.

Recommended protected response headers:

```http
Cache-Control: private, no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

## Edge ticket mode

Only a Cloudflare Worker or equivalent edge code that verifies HMAC can safely share cached static objects across users. A normal Cache Rule cannot validate HMAC by itself.
