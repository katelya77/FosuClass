import { SCENE_IDS, type DataMode, type QualityMode, type ShowcaseMode } from "../director/types";

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
  return raw.trim().length ? raw : null;
}

import type { SceneId } from "../director/types";

/**
 * URL 模式解析 —— Showcase 唯一入口契约。
 *   mode=record / data=fixture|live / autoplay=1|0
 *   scene=…（支持 risk/collaboration/reschedule/insight 短名）
 *   beat=…（场景节拍深链，如 resched.constraints）
 *   t=秒（绝对定位）
 *   quality=cinematic|balanced / recordHud=1
 * 非法值一律回退默认，录制现场不允许白屏。
 */
export interface UrlModes {
  mode: ShowcaseMode;
  data: DataMode;
  autoplay: boolean;
  scene?: SceneId;
  beat?: string;
  t?: number;
  quality: QualityMode;
  recordHud: boolean;
  preview?: "visual";
  rate?: number;
}

export interface UrlModeDefaults {
  mode?: ShowcaseMode;
  data?: DataMode;
  autoplay?: boolean;
  quality?: QualityMode;
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

  const qualityParam = params.get("quality");
  const quality: QualityMode =
    qualityParam === "cinematic" || qualityParam === "cinematic+record"
      ? "cinematic"
      : qualityParam === "balanced"
        ? "balanced"
        : (defaults.quality ?? "balanced");

  const recordHud = boolParam(params.get("recordHud")) ?? false;
  const preview = params.get("preview") === "visual" ? "visual" : undefined;
  const rawRate = params.get("rate");
  const parsedRate = rawRate === null ? Number.NaN : Number(rawRate);
  const rate = Number.isFinite(parsedRate) && parsedRate >= 0.25 && parsedRate <= 4 ? parsedRate : undefined;

  return {
    mode,
    data,
    autoplay,
    scene: normalizedScene && (SCENE_IDS as readonly string[]).includes(normalizedScene) ? (normalizedScene as UrlModes["scene"]) : undefined,
    beat,
    t,
    quality,
    recordHud,
    preview,
    rate,
  };
}
