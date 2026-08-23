import type { SceneId } from "./types";
import type { TransitionKind } from "../components/director/SceneTransition";

/** 场景 → 转场语言（只允许 3 套；与 SceneTransition 共用，供 ShowcaseApp 选择） */
export const SCENE_KIND: Record<SceneId, TransitionKind> = {
  opening: "focus",
  architecture: "sweep",
  "hero-risk": "sweep",
  "hero-collaboration": "focus",
  "hero-reschedule": "collapse",
  "hero-insight": "focus",
  reliability: "sweep",
  closing: "collapse",
};
