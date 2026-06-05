# Security and Access Control

## Boundary

Static JSON read by a mini program client cannot be absolutely secret. CORS, Referer, User-Agent, rate limiting, and short-lived tickets raise abuse cost, but they do not stop server-side proxies, packet capture, or forged clients.

Do not describe the system as "impossible to steal" or "absolutely protected".

## Dynamic API Controls

- Production dynamic API CORS must not use `Access-Control-Allow-Origin: *`.
- Admin origins are configured through `FOSU_ALLOWED_ADMIN_ORIGINS`.
- Public browser origins are configured through `FOSU_ALLOWED_PUBLIC_ORIGINS`.
- Admin write requests validate session/token and Origin when Origin is present.
- Dynamic public APIs use body-size limits, rate limiting, and optional mini-program session checks.
- Session mode can be off, monitor/optional, or required through environment policy.
- Do not put HMAC secrets, AppSecret, or fixed API keys into mini-program code.

## Static Resource Controls

- Default mode is public static Release Pack for speed.
- Optional ticket mode uses short-lived HMAC tickets scoped to release and path prefix.
- OpenResty or CDN must verify the ticket before serving protected paths.
- If CDN publicly caches a protected response without validating each request or using a safe cache key, protection fails.

## Logging

Logs must redact:

- `ADMIN_API_TOKEN`
- Relay tokens
- Session cookies
- `Authorization`
- WeChat AppSecret
- Cookie headers
- Local sensitive paths
- Passwords and database credentials
