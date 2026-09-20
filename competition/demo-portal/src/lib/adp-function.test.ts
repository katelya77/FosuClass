import { afterEach, describe, expect, it, vi } from "vitest";

import { onRequest } from "../../functions/api/adp/chat";
import { fetchAdp } from "../../functions/api/adp/upstream";

const OFFICIAL_ADP_CHAT_URL =
  "https://wss.lke.cloud.tencent.com/adp/v2/chat?language=zh-CN";

describe("ADP Pages Function upstream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the server-held credential only to the official HTTPS SSE endpoint", async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('event: error\ndata: {"Type":"error"}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new Request("https://adp.katelya.top/api/adp/chat", {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        origin: "https://adp.katelya.top",
      },
      body: JSON.stringify({
        conversationId: "123e4567-e89b-42d3-a456-426614174000",
        message: "你好",
      }),
    });

    const response = await onRequest({
      request,
      env: { ADP_APP_KEY: "redacted-test-value" },
    });

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(upstreamFetch.mock.calls[0]?.[0]).toBe(OFFICIAL_ADP_CHAT_URL);
    expect(upstreamFetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.not.objectContaining({ origin: expect.anything(), referer: expect.anything() }),
    });

    const upstreamBody = JSON.parse(
      new TextDecoder().decode(upstreamFetch.mock.calls[0]?.[1]?.body as Uint8Array),
    );
    expect(upstreamBody).toMatchObject({
      AppKey: "redacted-test-value",
      Contents: [{ Type: "text", Text: "你好" }],
    });
  });

  it("rejects a successful HTML response instead of presenting it as an SSE stream", async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("<html>not an ADP stream</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      fetchAdp(new TextEncoder().encode("{}"), "test-request-id", upstreamFetch),
    ).rejects.toThrow("non-SSE response");
  });
});
