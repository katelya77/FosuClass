import { useEffect } from "react";
import { useDirectorStore } from "../stores/directorStore";
import type { ShowcaseMode } from "./types";

type FrameHandle = number;

function scheduleFrame(cb: (t: number) => void): FrameHandle {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
  return window.setTimeout(() => cb(performance.now()), 16) as unknown as FrameHandle;
}

function cancelFrame(handle: FrameHandle): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else window.clearTimeout(handle as unknown as number);
}

/** rAF 驱动的 Director 引擎；StrictMode 双挂载安全（cleanup 取消帧） */
export function useDirectorEngine(): void {
  const playing = useDirectorStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25); // 后台标签页回来不跳帧
      last = now;
      const st = useDirectorStore.getState();
      st.tick(dt * st.playbackRate);
      handle = scheduleFrame(loop);
    };
    handle = scheduleFrame(loop);
    return () => cancelFrame(handle);
  }, [playing]);
}

/** 导演键盘指令（仅开发模式启用；录制模式完全静默）：
 *  空格 播放/暂停 · ←→ 上/下一场 · R 重播 · G 参考线 */
export function useKeyboardDirectives(mode: ShowcaseMode): void {
  useEffect(() => {
    if (mode === "record") return;
    const onKey = (e: KeyboardEvent) => {
      const s = useDirectorStore.getState();
      switch (e.key) {
        case " ":
          e.preventDefault();
          s.toggle();
          break;
        case "ArrowRight":
          s.nextScene();
          break;
        case "ArrowLeft":
          s.prevScene();
          break;
        case "r":
        case "R":
          s.restart();
          break;
        case "g":
        case "G":
          s.toggleGuides();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);
}
