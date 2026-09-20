import { ADP_STATUS_URL } from "./upstream";

const STATUS_TIMEOUT_MS = 5_000;
const APP_KEY_PATTERN = /^[A-Za-z0-9]{64,256}$/;

interface Env {
  ADP_APP_KEY?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

type UpstreamFetch = typeof fetch;

function healthResponse(status: number, ok: boolean, code: string): Response {
  return Response.json(
    { ok, code },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-adp-readiness": ok ? "ready" : "unavailable",
      },
    },
  );
}

export async function probeAdpReadiness(
  env: Env,
  upstreamFetch: UpstreamFetch = fetch,
): Promise<Response> {
  const appKey = env.ADP_APP_KEY?.trim() || "";
  if (!appKey) return healthResponse(503, false, "adp_not_configured");
  if (!APP_KEY_PATTERN.test(appKey)) {
    return healthResponse(503, false, "adp_key_malformed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const upstream = await upstreamFetch(ADP_STATUS_URL, {
      method: "HEAD",
      headers: { accept: "application/javascript" },
      signal: controller.signal,
    });
    if (!upstream.ok) return healthResponse(503, false, "adp_upstream_unavailable");
    return healthResponse(200, true, "ready");
  } catch {
    return healthResponse(503, false, "adp_upstream_unreachable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequest({ request, env }: PagesContext): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return healthResponse(405, false, "method_not_allowed");
  }

  const response = await probeAdpReadiness(env);
  if (method !== "HEAD") return response;
  return new Response(null, { status: response.status, headers: response.headers });
}
