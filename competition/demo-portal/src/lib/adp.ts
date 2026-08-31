/** Browser-facing ADP entry point. Upstream address and credentials stay server-side. */
export const ADP_CHAT_API_URL = "/api/adp/chat";
export const ADP_CONVERSATION_STORAGE_KEY = "campusflow.adp.conversation.v1";
export const ADP_DIAGNOSTICS_STORAGE_KEY = "campusflow.adp.diagnostics.v1";

export function getPersistentConversationId(storage?: Storage): string {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  const current = target?.getItem(ADP_CONVERSATION_STORAGE_KEY)?.trim();
  if (current && /^[0-9a-f-]{36}$/i.test(current)) return current;
  const created = crypto.randomUUID();
  target?.setItem(ADP_CONVERSATION_STORAGE_KEY, created);
  return created;
}

/** Credential markers used by tests and runtime assertions only. Never shipped as values. */
export const CREDENTIAL_MARKERS = [
  "appkey",
  "app_key",
  "secretid",
  "secretkey",
  "client_secret",
  "bearer ",
  "authorization:",
] as const;

export function containsCredentialMarker(text: string): boolean {
  const lower = text.toLowerCase();
  return CREDENTIAL_MARKERS.some((marker) => lower.includes(marker));
}
