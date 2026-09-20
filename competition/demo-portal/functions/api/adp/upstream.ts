export const ADP_CHAT_URL =
  "https://adp.gaoxiaobang.com/adp/v2/chat?language=zh-CN";
export const ADP_STATUS_URL = "https://adp.gaoxiaobang.com/webim/config.js";

const UPSTREAM_CONNECT_TIMEOUT_MS = 12_000;

type UpstreamFetch = typeof fetch;

export async function fetchAdp(
  body: Uint8Array,
  requestId: string,
  upstreamFetch: UpstreamFetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_CONNECT_TIMEOUT_MS);
  const requestBody = new Uint8Array(body).buffer;
  let upstream: Response;
  try {
    upstream = await upstreamFetch(ADP_CHAT_URL, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "accept-language": "zh-CN,zh;q=0.9",
        "content-type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const contentType = upstream.headers.get("content-type")?.toLowerCase() || "";
  if (upstream.ok && !contentType.includes("text/event-stream")) {
    await upstream.body?.cancel();
    throw new Error("ADP upstream returned a non-SSE response");
  }
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.delete("content-length");
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-store, no-cache, must-revalidate");
  headers.set("x-accel-buffering", "no");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-adp-request-id", requestId);
  headers.set("x-adp-transport", "competition-adp-sse");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
