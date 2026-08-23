import { create } from "zustand";
import {
  TOTAL_DURATION,
  getSceneAt,
  getSceneStart,
  nextScene as nextSceneOf,
  prevScene as prevSceneOf,
} from "../director/timeline";
import { resolveBeat } from "../director/heroes/registry";
import type { DataMode, QualityMode, SceneId } from "../director/types";

/**
 * Director 状态机 —— 单一事实源。
 * playing / paused / playbackRate / recordMode / autoplay / quality 全部集中于此，
 * 组件只订阅所需切片，避免整树 60fps 重渲染。
 */
export interface DirectorState {
  currentScene: SceneId;
  /** 程序时间（秒），rAF 精度 */
  elapsed: number;
  playing: boolean;
  paused: boolean;
  playbackRate: number;
  recordMode: boolean;
  autoplay: boolean;
  dataMode: DataMode;
  quality: QualityMode;
  recordHud: boolean;
  guidesVisible: boolean;
  /** 开发态预览录制画面（mode=record 的视觉等价物） */
  recordPreview: boolean;
  loop: boolean;

  play(): void;
  pause(): void;
  toggle(): void;
  restart(): void;
  nextScene(): void;
  prevScene(): void;
  goToScene(id: SceneId, opts?: { play?: boolean }): void;
  seek(sec: number): void;
  /** ?beat= 深链：跳到场景级节拍；未知 beat 返回 false（现场不白屏） */
  seekToBeat(beatId: string): boolean;
  setRate(rate: number): void;
  setRecordMode(on: boolean): void;
  setAutoplay(on: boolean): void;
  setDataMode(mode: DataMode): void;
  setQuality(q: QualityMode): void;
  setRecordHud(on: boolean): void;
  toggleGuides(): void;
  toggleRecordPreview(): void;
  setLoop(on: boolean): void;
  /** 由 rAF 引擎每帧调用；dt 已含 playbackRate */
  tick(dt: number): void;
}

export const useDirectorStore = create<DirectorState>((set, get) => ({
  currentScene: "opening",
  elapsed: 0,
  playing: false,
  paused: true,
  playbackRate: 1,
  recordMode: false,
  autoplay: false,
  dataMode: "fixture",
  quality: "balanced",
  recordHud: false,
  guidesVisible: false,
  recordPreview: false,
  loop: false,

  play: () => {
    if (get().elapsed >= TOTAL_DURATION - 1e-6) set({ elapsed: 0 });
    set({ playing: true, paused: false });
  },
  pause: () => set({ playing: false, paused: true }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  restart: () => set({ elapsed: 0, currentScene: "opening", playing: true, paused: false }),
  nextScene: () => get().goToScene(nextSceneOf(get().currentScene), { play: get().playing }),
  prevScene: () => {
    const { currentScene, elapsed } = get();
    const start = getSceneStart(currentScene);
    if (elapsed - start > 2) {
      get().seek(start);
      return;
    }
    get().goToScene(prevSceneOf(currentScene), { play: get().playing });
  },
  goToScene: (id, opts) => {
    const start = getSceneStart(id);
    const play = opts?.play ?? get().playing;
    set({ elapsed: start, currentScene: id, playing: play, paused: !play });
  },
  seek: (sec) => {
    const t = Math.min(Math.max(sec, 0), TOTAL_DURATION);
    set({ elapsed: t, currentScene: getSceneAt(t).scene });
  },
  seekToBeat: (beatId) => {
    const hit = resolveBeat(beatId);
    if (!hit) return false;
    const t = Math.min(getSceneStart(hit.scene) + hit.at + 0.01, TOTAL_DURATION - 0.05);
    set({ elapsed: t, currentScene: getSceneAt(t).scene });
    return true;
  },
  setRate: (rate) => set({ playbackRate: Math.min(Math.max(rate, 0.25), 3) }),
  setRecordMode: (on) => set({ recordMode: on }),
  setAutoplay: (on) => set({ autoplay: on }),
  setDataMode: (mode) => set({ dataMode: mode }),
  setQuality: (q) => set({ quality: q }),
  setRecordHud: (on) => set({ recordHud: on }),
  toggleGuides: () => set((s) => ({ guidesVisible: !s.guidesVisible })),
  toggleRecordPreview: () => set((s) => ({ recordPreview: !s.recordPreview })),
  setLoop: (on) => set({ loop: on }),

  tick: (dt) => {
    const s = get();
    if (!s.playing) return;
    let e = s.elapsed + dt;
    if (e >= TOTAL_DURATION) {
      if (s.loop) {
        e -= TOTAL_DURATION;
        set({ elapsed: e, currentScene: getSceneAt(e).scene });
        return;
      }
      set({ elapsed: TOTAL_DURATION, playing: false, paused: true });
      return;
    }
    set({ elapsed: e, currentScene: getSceneAt(e).scene });
  },
}));

/** 场景内节拍时钟：量化到 0.1s，把场景子树的渲染频率压到 ~10fps 而动画依旧平滑
 *  （元素级平滑由 Motion 的独立 transition 负责，节拍时钟只做「到点触发」） */
export function quantizeBeat(localSeconds: number): number {
  return Math.floor(Math.max(localSeconds, 0) * 10) / 10;
}

/** Hero 场景时钟：返回场景内量化秒数；配合各 heroTimeline 的 beats 做门控 */
export function useHeroClock(sceneId: SceneId): number {
  return useDirectorStore((s) => quantizeBeat(s.elapsed - getSceneStart(sceneId)));
}

/** 节拍门控：local >= at 即到达 */
export function reached(localClock: number, at: number): boolean {
  return localClock >= at;
}
