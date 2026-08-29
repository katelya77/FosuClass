/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 腾讯云智能 ADP 真机嵌入地址（公开 URL，禁止放凭据） */
  readonly VITE_ADP_EMBED_URL?: string;
  /** WebIM 地址（公开 URL，可配置项） */
  readonly VITE_ADP_WEBIM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
