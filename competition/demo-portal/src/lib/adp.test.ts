import { describe, expect, it } from "vitest";

import {
  ADP_CHAT_API_URL,
  containsCredentialMarker,
  getPersistentConversationId,
} from "./adp";

describe("ADP native browser boundary", () => {
  it("uses only the same-origin server endpoint", () => {
    expect(ADP_CHAT_API_URL).toBe("/api/adp/chat");
  });

  it("reuses a valid anonymous conversation id", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } as unknown as Storage;
    const first = getPersistentConversationId(adapter);
    expect(getPersistentConversationId(adapter)).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("rejects an invalid stored conversation id", () => {
    const values = new Map([["campusflow.adp.conversation.v1", "invalid"]]);
    const adapter = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;
    expect(getPersistentConversationId(adapter)).not.toBe("invalid");
  });

  it("detects credential-shaped text before it reaches diagnostics or artifacts", () => {
    expect(containsCredentialMarker("Authorization: Bearer redacted")).toBe(true);
    expect(containsCredentialMarker("匿名演示数据 · 已核验")).toBe(false);
  });
});
