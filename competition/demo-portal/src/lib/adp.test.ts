import { describe, expect, it } from "vitest";

import { isMixedContentEmbed, resolveAdpConfig } from "./adp";

describe("ADP public embed configuration", () => {
  it("flags HTTPS page to HTTP frame as mixed content", () => {
    expect(isMixedContentEmbed("https:", "http://101.42.184.216/webim/#/chat/uxjybB")).toBe(true);
  });

  it("allows same-protocol HTTP locally and future HTTPS ADP without page changes", () => {
    expect(isMixedContentEmbed("http:", "http://101.42.184.216/webim/#/chat/uxjybB")).toBe(false);
    expect(isMixedContentEmbed("https:", "https://adp.example.com/chat")).toBe(false);
  });

  it("keeps both public visitor URLs in the centralized config", () => {
    const config = resolveAdpConfig({
      VITE_ADP_EMBED_URL: "https://adp.example.com/app",
      VITE_ADP_WEBIM_URL: "https://adp.example.com/webim",
    });
    expect(config).toEqual({
      chatUrl: "https://adp.example.com/app",
      webimUrl: "https://adp.example.com/webim",
    });
  });
});
