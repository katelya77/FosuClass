/**
 * ADP public embed URLs. These are attendance-facing public URLs, never credentials.
 * The demo portal is a static public site and intentionally ships no AppKey / Secret.
 */
export const DEFAULT_ADP_CHAT_URL =
  "http://101.42.184.216/adp-chat-client/#/app/2084871572396491520";
export const DEFAULT_ADP_WEBIM_URL = "http://101.42.184.216/webim/#/chat/uxjybB";

export interface AdpEnvLike {
  VITE_ADP_EMBED_URL?: string;
  VITE_ADP_WEBIM_URL?: string;
}

export interface AdpFrameConfig {
  chatUrl: string;
  webimUrl: string;
}

export function isMixedContentEmbed(pageProtocol: string, frameUrl: string): boolean {
  return pageProtocol.toLowerCase() === "https:" && /^http:\/\//i.test(frameUrl.trim());
}

export function resolveAdpConfig(env?: AdpEnvLike): AdpFrameConfig {
  const runtimeEnv = (import.meta.env ?? {}) as unknown as AdpEnvLike;
  return {
    chatUrl:
      env?.VITE_ADP_EMBED_URL?.trim() ||
      runtimeEnv.VITE_ADP_EMBED_URL?.trim() ||
      DEFAULT_ADP_CHAT_URL,
    webimUrl:
      env?.VITE_ADP_WEBIM_URL?.trim() ||
      runtimeEnv.VITE_ADP_WEBIM_URL?.trim() ||
      DEFAULT_ADP_WEBIM_URL,
  };
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
