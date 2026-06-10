# Cold Start Runtime

The cold-start path now resolves a lightweight active runtime pointer before loading large release indexes.

Flow:

1. Read local active release cache if present.
2. Fetch `/static/runtime/active.json` with no session dependency.
3. Fall back to `/api/fosu/runtime/active`, then dynamic `app-config` if needed.
4. Apply `termConfig` immediately so pages can render dates and labels.
5. Load `bootstrap`, notices, session warmup, and release indexes in background singleflight tasks.
6. Delay `periodic-data` until at least 10 seconds after app startup.

The runtime pointer is generated after successful release activation and contains only term, release version, cache epoch, term config, and static URLs. It is intentionally small and safe to serve as public static JSON.

Diagnostics are available in development/test through `X-Fosu-Request-Stats`:

```json
{
  "requestId": "mabc-123",
  "route": "/api/fosu/bootstrap",
  "totalMs": 12,
  "fileReadCount": 2,
  "jsonParseCount": 2,
  "payloadBytes": 4096,
  "cacheHit": true,
  "source": "release-bootstrap",
  "releaseVersion": "2026-...",
  "term": "2025-2026-2"
}
```

Sensitive values such as sessions, tickets, cookies, OpenID and tokens are not recorded.
