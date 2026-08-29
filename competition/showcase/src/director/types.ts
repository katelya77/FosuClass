/** 场景 ID：Phase 1 全量 8 个场景（Shell 或成品） */
export const SCENE_IDS = [
  "opening",
  "architecture",
  "hero-risk",
  "hero-collaboration",
  "hero-reschedule",
  "hero-insight",
  "reliability",
  "closing",
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

/** 时间轴事件：at 为整片程序时间（秒），scene 为所属场景 */
export type TimelineEvent = {
  at: number;
  scene: SceneId;
  action: string;
};

export interface SceneMeta {
  id: SceneId;
  /** 中文场景名（ProgressRail / Debug 面板用） */
  label: string;
  /** 场景时长（秒） */
  duration: number;
}

export type DataMode = "fixture" | "live";
export type ShowcaseMode = "dev" | "record";
/** 画质：cinematic=全效果（录屏）；balanced=降密度（调试） */
export type QualityMode = "cinematic" | "balanced";

export interface UrlModes {
  mode: ShowcaseMode;
  data: DataMode;
  autoplay: boolean;
  scene?: SceneId;
  /** 起始秒（截图/调试用） */
  t?: number;
  /** 画质 */
  quality: QualityMode;
  /** 录制指示器（REC/时间）；默认 0 完全纯净 */
  recordHud: boolean;
  /** 视觉预览路由 */
  preview?: "visual";
  /** 播放速率（预览/录制用） */
  rate?: number;
}