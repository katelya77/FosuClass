/**
 * ADP public embed URLs. These are attendance-facing public URLs, never credentials.
 * The demo portal is a static public site and intentionally ships no AppKey / Secret.
 */
export const DEFAULT_ADP_CHAT_URL =
  "http://101.42.184.216/adp-chat-client/#/app/2084871572396491520";
export const DEFAULT_ADP_WEBIM_URL = "http://101.42.184.216/webim/#/chat/uxjybB";
export const ADP_RELAY_CHAT_URL = "/adp-chat-client/#/app/2084871572396491520";
export const ADP_RELAY_WEBIM_URL = "/webim/#/chat/uxjybB";
export const ADP_RELAY_HEALTH_URL = "/adp-relay-health";

export interface AdpEnvLike {
  VITE_ADP_EMBED_URL?: string;
  VITE_ADP_WEBIM_URL?: string;
}

export interface AdpFrameConfig {
  /** iframe 使用地址；HTTPS Pages 上自动指向同源 relay。 */
  chatUrl: string;
  webimUrl: string;
  /** 外开使用官方公开地址，永远不携带 AppKey、token 或 clientId。 */
  externalChatUrl: string;
  externalWebimUrl: string;
  relayActive: boolean;
  relayHealthUrl: string;
}

export function isMixedContentEmbed(pageProtocol: string, frameUrl: string): boolean {
  return pageProtocol.toLowerCase() === "https:" && /^http:\/\//i.test(frameUrl.trim());
}

export function resolveAdpConfig(env?: AdpEnvLike, pageProtocol?: string): AdpFrameConfig {
  const runtimeEnv = (import.meta.env ?? {}) as unknown as AdpEnvLike;
  const externalChatUrl =
    env?.VITE_ADP_EMBED_URL?.trim() ||
    runtimeEnv.VITE_ADP_EMBED_URL?.trim() ||
    DEFAULT_ADP_CHAT_URL;
  const externalWebimUrl =
    env?.VITE_ADP_WEBIM_URL?.trim() ||
    runtimeEnv.VITE_ADP_WEBIM_URL?.trim() ||
    DEFAULT_ADP_WEBIM_URL;
  const protocol =
    pageProtocol ?? (typeof window !== "undefined" ? window.location.protocol : "http:");
  const relayActive =
    isMixedContentEmbed(protocol, externalChatUrl) ||
    isMixedContentEmbed(protocol, externalWebimUrl);

  return {
    chatUrl: relayActive ? ADP_RELAY_CHAT_URL : externalChatUrl,
    webimUrl: relayActive ? ADP_RELAY_WEBIM_URL : externalWebimUrl,
    externalChatUrl,
    externalWebimUrl,
    relayActive,
    relayHealthUrl: ADP_RELAY_HEALTH_URL,
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
