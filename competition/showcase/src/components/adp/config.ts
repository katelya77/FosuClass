
/** ADP 真机默认体验地址（公开 URL，非凭据；可被 VITE_ 环境变量覆盖） */
export const DEFAULT_ADP_CHAT_URL = "http://101.42.184.216/adp-chat-client/#/app/2084871572396491520";
export const DEFAULT_ADP_WEBIM_URL = "http://101.42.184.216/webim/#/chat/uxjybB";

export interface AdpEnvLike {
  VITE_ADP_EMBED_URL?: string;
  VITE_ADP_WEBIM_URL?: string;
}

export interface AdpFrameConfig {
  chatUrl: string;
  webimUrl: string;
}

export function resolveAdpConfig(env: AdpEnvLike = import.meta.env): AdpFrameConfig {
  return {
    chatUrl: env.VITE_ADP_EMBED_URL?.trim() || DEFAULT_ADP_CHAT_URL,
    webimUrl: env.VITE_ADP_WEBIM_URL?.trim() || DEFAULT_ADP_WEBIM_URL,
  };
}

/**
 * 凭据标记黑名单 —— 用于测试与运行时断言：
 * 任何 AppKey/Secret/Bearer 类字符串都禁止进入 Showcase 配置与产物。
 */
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
  return CREDENTIAL_MARKERS.some((m) => lower.includes(m));
}
