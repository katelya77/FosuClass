import { SCENE_IDS, type DataMode, type ShowcaseMode, type UrlModes } from "../director/types";

/**
 * URL 模式解析 —— Showcase 唯一的入口契约。
 *   ?mode=record   录制模式（隐藏一切开发控制）
 *   ?data=fixture  占位快照数据（默认）；?data=live 表示 ADP 实时
 *   ?autoplay=1|0  自动播放（record 默认开）
 *   ?scene=...     直接跳转场景
 *   ?t=12.5        起始秒（截图 / 调试）
 * 非法值一律回退默认，绝不抛错——录制现场不允许白屏。
 */
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

  const rawScene = params.get("scene");
  const scene = (SCENE_IDS as readonly string[]).includes(rawScene ?? "")
    ? (rawScene as UrlModes["scene"])
    : undefined;

  const rawT = params.get("t");
  const parsedT = rawT === null ? Number.NaN : Number(rawT);
  const t = Number.isFinite(parsedT) && parsedT >= 0 ? parsedT : undefined;

  return { mode, data, autoplay, scene, t };
}
