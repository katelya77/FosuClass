import type { SceneId, SceneMeta, TimelineEvent } from "./types";

/**
 * Director Timeline — Phase 1 只编排到「骨架节奏」。
 * Opening 拥有完整节拍；其余场景使用 shell 节拍，架构允许 Phase 2 无损扩展。
 */

export const SCENES: SceneMeta[] = [
  { id: "opening", label: "开场 · 时空关系", duration: 24 },
  { id: "architecture", label: "架构 · 多智能体", duration: 16 },
  { id: "hero-risk", label: "英雄 · 风险发现", duration: 14 },
  { id: "hero-collaboration", label: "英雄 · 协作共创", duration: 14 },
  { id: "hero-reschedule", label: "英雄 · 调课推演", duration: 16 },
  { id: "hero-insight", label: "英雄 · 全局洞察", duration: 14 },
  { id: "reliability", label: "可靠性 · 真机证据", duration: 14 },
  { id: "closing", label: "收束 · 品牌落版", duration: 12 },
];

/** Opening 的完整节拍（0~12s 叙事 + hold） */
export const OPENING_BEATS: TimelineEvent[] = [
  { at: 0.0, scene: "opening", action: "enter" },
  { at: 1.2, scene: "opening", action: "nodes" },
  { at: 4.0, scene: "opening", action: "connections" },
  { at: 8.0, scene: "opening", action: "focus" },
  { at: 12.0, scene: "opening", action: "brand" },
  { at: 18.0, scene: "opening", action: "hold" },
];

/** Shell 场景的通用节拍（Phase 2 替换为各自真实节拍） */
const SHELL_BEATS: Array<{ at: number; action: string }> = [
  { at: 0.0, action: "enter" },
  { at: 2.0, action: "scaffold" },
  { at: 6.0, action: "focus" },
];

function beatsFor(scene: SceneId): TimelineEvent[] {
  if (scene === "opening") return OPENING_BEATS;
  return SHELL_BEATS.map((b) => ({ ...b, scene }));
}

/** 整片程序级事件表：每个场景的 enter 事件按累计起点生成 */
export const PROGRAM_EVENTS: TimelineEvent[] = (() => {
  const events: TimelineEvent[] = [];
  let cursor = 0;
  for (const scene of SCENES) {
    events.push({ at: Number(cursor.toFixed(3)), scene: scene.id, action: "enter" });
    events.push(...beatsFor(scene.id).filter((b) => b.action !== "enter").map((b) => ({
      at: Number((cursor + b.at).toFixed(3)),
      scene: b.scene,
      action: b.action,
    })));
    cursor += scene.duration;
  }
  return events.sort((a, b) => a.at - b.at);
})();

export const TOTAL_DURATION = SCENES.reduce((sum, s) => sum + s.duration, 0);

export function getSceneStart(id: SceneId): number {
  let start = 0;
  for (const s of SCENES) {
    if (s.id === id) return start;
    start += s.duration;
  }
  return 0;
}

export interface ScenePosition {
  scene: SceneId;
  /** 场景内局部时间（秒） */
  local: number;
}

/** 由程序时间定位当前场景；越界收敛到首/尾帧内 */
export function getSceneAt(elapsed: number): ScenePosition {
  const clamped = Math.min(Math.max(elapsed, 0), Math.max(TOTAL_DURATION - 0.001, 0));
  let cursor = 0;
  for (const s of SCENES) {
    if (clamped < cursor + s.duration || s === SCENES[SCENES.length - 1]) {
      return { scene: s.id, local: clamped - cursor };
    }
    cursor += s.duration;
  }
  return { scene: "closing", local: 0 };
}

export function getSceneMeta(id: SceneId): SceneMeta {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}

export function nextScene(id: SceneId): SceneId {
  const i = SCENES.findIndex((s) => s.id === id);
  return SCENES[Math.min(i + 1, SCENES.length - 1)].id;
}

export function prevScene(id: SceneId): SceneId {
  const i = SCENES.findIndex((s) => s.id === id);
  return SCENES[Math.max(i - 1, 0)].id;
}
