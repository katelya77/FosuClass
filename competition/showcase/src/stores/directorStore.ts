import { create } from "zustand";
import {
  TOTAL_DURATION,
  getSceneAt,
  getSceneStart,
  nextScene as nextSceneOf,
  prevScene as prevSceneOf,
} from "../director/timeline";
import type { DataMode, SceneId } from "../director/types";

/**
 * Director 状态机 —— 单一事实源。
 * playing / paused / playbackRate / recordMode / autoplay 全部集中于此，
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
  setRate(rate: number): void;
  setRecordMode(on: boolean): void;
  setAutoplay(on: boolean): void;
  setDataMode(mode: DataMode): void;
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
    // 场景内已播 >2s 时先回到本场景开头，符合剪辑直觉
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
  setRate: (rate) => set({ playbackRate: Math.min(Math.max(rate, 0.25), 3) }),
  setRecordMode: (on) => set({ recordMode: on }),
  setAutoplay: (on) => set({ autoplay: on }),
  setDataMode: (mode) => set({ dataMode: mode }),
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
