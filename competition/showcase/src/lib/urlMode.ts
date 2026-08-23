import { SCENE_IDS, type DataMode, type ShowcaseMode } from "../director/types";

/** 场景别名：录屏现场用短名 */
const SCENE_ALIASES: Record<string, string> = {
  risk: "hero-risk",
  collaboration: "hero-collaboration",
  reschedule: "hero-reschedule",
  insight: "hero-insight",
};

function normalizeScene(raw: string | null): string | null {
  if (!raw) return null;
  const aliased = SCENE_ALIASES[raw] ?? raw;
  return (SCENE_IDS as readonly string[]).includes(aliased) ? aliased : null;
}

function normalizeBeat(raw: string | null): string | null {
  if (!raw) return null;
  // 延迟校验：registry 循环依赖风险低，但这里只做非空校验，合法性由 store.seekToBeat 兜底
  return raw.trim().length ? raw : null;
}

import type { SceneId } from "../director/types";

/**
 * URL 模式解析 —— Showcase 唯一入口契约。
 *   mode=record / data=fixture|live / autoplay=1|0
 *   scene=…（支持 risk/collaboration/reschedule/insight 短名）
 *   beat=…（场景节拍深链，如 resched.constraints）
 *   t=秒（绝对定位）
 * 非法值一律回退默认，录制现场不允许白屏。
 */
export interface UrlModes {
  mode: ShowcaseMode;
  data: DataMode;
  autoplay: boolean;
  scene?: SceneId;
  beat?: string;
  t?: number;
}

export interface UrlModeDefaults {
  mode?: ShowcaseMode;
  data?: DataMode;
  autoplay?: boolean;
}

function boolParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

export function parseShowcaseUrl(search: string, defaults: UrlModeDefaults = {}): UrlModes {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const rawMode = params.get("mode");
  const mode: ShowcaseMode =
    rawMode === "record" || rawMode === "preview" ? "record" : (defaults.mode ?? "dev");

  const rawData = params.get("data");
  const data: DataMode = rawData === "live" ? "live" : rawData === "fixture" ? "fixture" : (defaults.data ?? "fixture");

  const autoParam = boolParam(params.get("autoplay"));
  const autoplay = autoParam ?? defaults.autoplay ?? (mode === "record");

  const normalizedScene = normalizeScene(params.get("scene"));
  const rawT = params.get("t");
  const parsedT = rawT === null ? Number.NaN : Number(rawT);
  const t = Number.isFinite(parsedT) && parsedT >= 0 ? parsedT : undefined;
  const beat = normalizeBeat(params.get("beat")) ?? undefined;

  return {
    mode,
    data,
    autoplay,
    scene: normalizedScene && (SCENE_IDS as readonly string[]).includes(normalizedScene) ? (normalizedScene as UrlModes["scene"]) : undefined,
    beat,
    t,
  };
}