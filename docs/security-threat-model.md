# FosuClass security threat model

This iteration protects against anonymous, long-lived, bulk, low-cost reuse of FosuClass API and static Release Pack data. It does not claim that data already readable by a legitimate client can be made absolutely impossible to extract.

## Threats

A. Third-party webpage hotlinking: mitigated by ticket mode, strict static response headers, and optional Referer checks. Referer is only auxiliary.

B. Anonymous script bulk download: mitigated by session-gated dynamic APIs, short-lived static tickets, bounded rate limits, and suspicious enumeration events.

C. Direct API calls after discovering `/api/fosu/*`: mitigated by `FOSU_SECURITY_MODE=session|ticket` and centralized route policy. `observe` only records.

D. Short-term reuse after obtaining a valid ticket: accepted residual risk. Tickets are bearer credentials, short-lived, release-scoped, and never placed in URLs.

E. WeChat miniprogram reverse engineering: no long-lived shared secret, AppSecret, HMAC secret, admin token, or raw openid is stored in client code.

F. Admin brute-force login: existing login limiter remains, admin login failures become structured security events, and browser writes require Origin plus CSRF.

G. Admin token leak: browser Cookie auth and `ADMIN_API_TOKEN` auth are separated. CLI token calls bypass CSRF by design, but token value is never logged.

H. Cloudflare cache bypassing origin authorization: ticket-protected responses must not be publicly cached unless edge HMAC verification is implemented.

I. `X-Forwarded-For` / `CF-Connecting-IP` spoofing: proxy headers are trusted only when the socket peer is loopback, private network, or configured trusted proxy.

J. Path traversal, directory scan, backup exposure: static ticket verification normalizes decoded paths; OpenResty template denies dotfiles, backups, logs, source maps, archives, and non-GET/HEAD methods.

K. Request flooding causing Node/OpenResty load: dynamic endpoints use bounded in-memory rate limits. Static protection is designed for OpenResty local verification or cached auth fallback, not per-file body reads by Node.

L. Ticket/session leakage in logs, URLs, or screenshots: sensitive bearer values are never appended to URLs, and safe logging redacts token/session/ticket fields.

## Security modes

`FOSU_SECURITY_MODE=observe|session|ticket`

`observe` keeps compatibility and records what strict mode would reject.

`session` requires valid `X-Fosu-Session` for dynamic miniprogram data APIs. Static Release Pack remains public.

`ticket` requires dynamic session and static Release Pack ticket. Enable only after OpenResty and Cloudflare cache checks pass.

Fast rollback:

```env
FOSU_SECURITY_MODE=observe
FOSU_STATIC_ACCESS_MODE=public
```

Rollback does not require rebuilding Release Pack.
