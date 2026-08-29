import { useEffect } from "react";

/**
 * usePointerField —— Phase 2.6 Director 交互层（极轻量）。
 *
 * 职责：把指针位置归一化为 -1..1 的场变量，写入 .stage 的 CSS 自定义属性：
 *   --px / --py   归一化指针（弹性跟随，用于卡片 depth shift、关系线 pulse）
 *   --spot-x / --spot-y  聚光位置（百分比，用于背景光场向焦点轻微偏移）
 *
 * 纪律：
 *   · 仅 Director/预览模式启用；Record Mode 完全不监听（录屏绝不依赖鼠标）。
 *   · 单例监听 + rAF 合帧；指针不动时 rAF 自动停转（零常驻功耗）。
 *   · document hidden 时暂停；卸载时移除全部监听并复位变量。
 *   · 数值经 lerp 平滑（约 0.12/帧），产生"光场被轻轻吸过去"的手感而非跟枪。
 */

export const POINTER_VARS = ["--px", "--py", "--spot-x", "--spot-y"] as const;

interface PointerFieldHandle {
  targetX: number;
  targetY: number;
  curX: number;
  curY: number;
  raf: number;
  running: boolean;
}

const handle: PointerFieldHandle = {
  targetX: 0, targetY: 0, curX: 0, curY: 0, raf: 0, running: false,
};

function step(): void {
  handle.curX += (handle.targetX - handle.curX) * 0.12;
  handle.curY += (handle.targetY - handle.curY) * 0.12;
  const stage = document.querySelector<HTMLElement>(".stage");
  if (stage) {
    stage.style.setProperty("--px", handle.curX.toFixed(4));
    stage.style.setProperty("--py", handle.curY.toFixed(4));
    stage.style.setProperty("--spot-x", (50 + handle.curX * 6).toFixed(2) + "%");
    stage.style.setProperty("--spot-y", (44 + handle.curY * 5).toFixed(2) + "%");
  }
  const settled = Math.abs(handle.targetX - handle.curX) < 0.0008 && Math.abs(handle.targetY - handle.curY) < 0.0008;
  if (settled) {
    handle.running = false;
    return; // 收敛后停转 rAF；下一次 pointermove 重新点火
  }
  handle.raf = requestAnimationFrame(step);
}

function kick(): void {
  if (!handle.running) {
    handle.running = true;
    handle.raf = requestAnimationFrame(step);
  }
}

function onMove(e: PointerEvent): void {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  handle.targetX = Math.min(Math.max((e.clientX / w) * 2 - 1, -1), 1);
  handle.targetY = Math.min(Math.max((e.clientY / h) * 2 - 1, -1), 1);
  kick();
}

function onLeave(): void {
  handle.targetX = 0;
  handle.targetY = 0;
  kick();
}

function onVisibility(): void {
  if (document.hidden) {
    if (handle.running) cancelAnimationFrame(handle.raf);
    handle.running = false;
  }
}

/** Record Mode（active=false）不挂任何监听；dev/preview 挂载并在卸载时清理。 */
export function usePointerField(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined" || typeof PointerEvent === "undefined") return;
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      if (handle.running) cancelAnimationFrame(handle.raf);
      handle.running = false;
      const stage = document.querySelector<HTMLElement>(".stage");
      if (stage) {
        for (const v of POINTER_VARS) stage.style.removeProperty(v);
      }
    };
  }, [active]);
}
