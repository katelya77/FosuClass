import { describe, expect, it, vi } from "vitest";
import { probeAdpReadiness } from "../../functions/api/adp/health";
import { ADP_STATUS_URL } from "../../functions/api/adp/upstream";

const VALID_APP_KEY = "a".repeat(128);

describe("ADP readiness probe", () => {
  it("checks the pinned tenant front door without transmitting the AppKey", async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "application/javascript" },
      }),
    );

    const response = await probeAdpReadiness(
      { ADP_APP_KEY: VALID_APP_KEY },
      upstreamFetch as typeof fetch,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, code: "ready" });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe(ADP_STATUS_URL);
    expect(init).toMatchObject({ method: "HEAD" });
    expect(JSON.stringify(init)).not.toContain(VALID_APP_KEY);
  });

  it.each([
    [undefined, "adp_not_configured"],
    ["copied-with-。", "adp_key_malformed"],
  ])("fails closed before any network call for an invalid secret", async (appKey, code) => {
    const upstreamFetch = vi.fn();
    const response = await probeAdpReadiness(
      { ADP_APP_KEY: appKey },
      upstreamFetch as typeof fetch,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("reports an unreachable tenant without exposing upstream details", async () => {
    const response = await probeAdpReadiness(
      { ADP_APP_KEY: VALID_APP_KEY },
      vi.fn(async () => {
        throw new Error("internal network details");
      }) as typeof fetch,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "adp_upstream_unreachable" });
  });
});
