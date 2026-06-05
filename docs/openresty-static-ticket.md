# OpenResty Static Ticket Mode

`FOSU_STATIC_ACCESS_MODE=public` is the default. Use `ticket` only when OpenResty or the CDN can verify tickets reliably.

## Ticket Contract

The ticket is an HMAC token with:

- `releaseVersion`
- `pathPrefix`
- `exp`
- `iat`
- `nonce`

It contains no sensitive user information.

## Node Helpers

```js
const {
  createStaticAccessTicket,
  verifyStaticAccessTicket,
} = require("./server/src/utils/staticAccessTicket");

const ticket = createStaticAccessTicket({
  releaseVersion: "2026-06-05T12-39-28",
  pathPrefix: "/index/class/",
  ttlSeconds: 300,
});
```

## OpenResty Pattern

Use one of these safe patterns:

- Verify HMAC at the CDN edge before cache lookup.
- Disable public edge cache for protected paths.
- Use a CDN feature that validates authorization and uses a safe shared cache key.

Do not only authenticate at the origin while allowing the CDN to publicly cache authorized responses.

## Referer Guard

Referer blocking can reduce hotlinking from third-party websites, but it is not the primary security mechanism. Mini-program requests may not carry a useful Referer.
