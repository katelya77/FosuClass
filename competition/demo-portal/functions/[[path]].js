const ADP_PUBLIC_ORIGIN = "http://101.42.184.216";
// Workers subrequests cannot target an IP literal. This fixed DNS name resolves
// to the same public ADP address and preserves a URL hostname for fetch().
const ADP_FETCH_ORIGIN = "http://101.42.184.216.nip.io";

const DIRECT_API_PREFIXES = [
  "/account/",
  "/application/",
  "/chat/",
  "/dev/",
  "/feedback/",
  "/file/",
  "/helper/",
  "/reference/",
  "/share/",
  "/system/",
];

const BLOCKED_ORIGIN_PREFIXES = [
  "/adp",
  "/admin",
  "/api/admin",
  "/openapi",
  "/swagger",
  "/.git",
];

function isSameOriginRequest(request, requestUrl) {
  const origin = request.headers.get("origin");
  return !origin || origin === requestUrl.origin;
}

function resolveUpstreamPath(pathname) {
  if (pathname.startsWith("/adp-chat-client/")) return pathname;
  if (pathname === "/adp-chat-client") return "/adp-chat-client/";
  if (pathname.startsWith("/webim/")) return pathname;
  if (pathname === "/webim") return "/webim/";

  if (pathname.startsWith("/adp-origin/")) {
    const upstreamPath = pathname.slice("/adp-origin".length) || "/";
    const lower = upstreamPath.toLowerCase();
    if (BLOCKED_ORIGIN_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null;
    return upstreamPath;
  }

  if (DIRECT_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return pathname;
  return null;
}

function upstreamRequestHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("host");
  headers.delete("referer");
  headers.set("origin", ADP_PUBLIC_ORIGIN);
  return headers;
}

function rewriteLocation(value, publicOrigin) {
  if (!value) return value;
  if (value.startsWith(`${ADP_PUBLIC_ORIGIN}/adp-chat-client`)) {
    return value.replace(ADP_PUBLIC_ORIGIN, publicOrigin);
  }
  if (value.startsWith(`${ADP_PUBLIC_ORIGIN}/webim`)) {
    return value.replace(ADP_PUBLIC_ORIGIN, publicOrigin);
  }
  if (value.startsWith(ADP_PUBLIC_ORIGIN)) {
    return `${publicOrigin}/adp-origin${value.slice(ADP_PUBLIC_ORIGIN.length)}`;
  }
  if (value.startsWith(ADP_FETCH_ORIGIN)) {
    return `${publicOrigin}/adp-origin${value.slice(ADP_FETCH_ORIGIN.length)}`;
  }
  return value;
}

function relayError(status, message) {
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff8f4;color:#332724;font:15px/1.7 system-ui,-apple-system,"Microsoft YaHei",sans-serif}.card{max-width:34rem;margin:2rem;padding:2rem;border:1px solid #f0d8d1;border-radius:26px;background:#fffdfb;box-shadow:0 24px 70px rgba(132,62,47,.12);text-align:center}strong{display:block;margin-bottom:.5rem;color:#b94535;font-size:1.25rem}</style></head><body><div class="card"><strong>小序安全连接暂不可用</strong>${message}</div></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

async function healthCheck() {
  try {
    const response = await fetch(`${ADP_FETCH_ORIGIN}/adp-chat-client/`, {
      method: "GET",
      redirect: "manual",
    });
    if (response.body) await response.body.cancel();
    return new Response(null, {
      status: response.ok ? 204 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

/**
 * Cloudflare Pages HTTPS relay for the two public, anonymous ADP experiences.
 * The upstream host is fixed, admin routes are denied, credentials are stripped,
 * and response bodies remain streamed except for the tiny WebIM runtime config.
 */
export async function onRequest({ request }) {
  const requestUrl = new URL(request.url);

  if (requestUrl.pathname === "/adp-relay-health") return healthCheck();

  if (!isSameOriginRequest(request, requestUrl)) {
    return relayError(403, "此连接只接受当前体验页发起的请求。");
  }

  const upstreamPath = resolveUpstreamPath(requestUrl.pathname);
  if (!upstreamPath) return relayError(404, "该路径不属于公开真机体验范围。");

  const upstreamUrl = new URL(`${ADP_FETCH_ORIGIN}${upstreamPath}`);
  upstreamUrl.search = requestUrl.search;

  const init = {
    method: request.method,
    headers: upstreamRequestHeaders(request),
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(new Request(upstreamUrl, init));
  } catch {
    return relayError(502, "上游真机暂时没有响应，请返回案例引导并使用外开入口。");
  }

  const headers = new Headers(upstreamResponse.headers);
  headers.delete("set-cookie");
  headers.set("x-content-type-options", "nosniff");
  const location = rewriteLocation(headers.get("location"), requestUrl.origin);
  if (location) headers.set("location", location);

  const isWebimConfig = requestUrl.pathname === "/webim/config.js";
  if (isWebimConfig) {
    const source = await upstreamResponse.text();
    const rewritten = source.replace(
      /domain\s*:\s*['"]http:\/\/101\.42\.184\.216\/['"]/,
      "domain: window.location.origin + '/adp-origin/'",
    );
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("cache-control", "no-store");
    headers.set("content-type", "application/javascript; charset=utf-8");
    return new Response(rewritten, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}
