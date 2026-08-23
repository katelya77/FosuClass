import { useEffect, useRef } from "react";
import { useDirectorStore } from "../../stores/directorStore";
import type { SceneId } from "../../director/types";

/** 每个 Scene 的世界底色：让画面始终"活着"，但 opacity 极低、绝不抢业务信息 */
const ATMOS: Record<SceneId, { base: string; secondary: string; warm?: string }> = {
  opening: { base: "rgba(79,214,166,0.12)", secondary: "rgba(156,194,226,0.09)" },
  architecture: { base: "rgba(127,173,214,0.12)", secondary: "rgba(74,127,176,0.11)" },
  "hero-risk": { base: "rgba(127,173,214,0.12)", secondary: "rgba(156,194,226,0.1)", warm: "rgba(238,198,148,0.12)" },
  "hero-collaboration": { base: "rgba(79,214,166,0.11)", secondary: "rgba(127,173,214,0.11)" },
  "hero-reschedule": { base: "rgba(79,214,166,0.12)", secondary: "rgba(156,194,226,0.11)", warm: "rgba(238,198,148,0.08)" },
  "hero-insight": { base: "rgba(74,127,176,0.13)", secondary: "rgba(156,194,226,0.11)" },
  reliability: { base: "rgba(127,173,214,0.12)", secondary: "rgba(79,214,166,0.09)" },
  closing: { base: "rgba(79,214,166,0.11)", secondary: "rgba(156,194,226,0.08)" },
};

function readQuality(): "cinematic" | "balanced" {
  const q = new URLSearchParams(window.location.search).get("quality");
  return q === "cinematic" || q === "cinematic+record" ? "cinematic" : "balanced";
}

/**
 * AmbientBackground —— 全局唯一环境背景（Phase 2.6）。
 * 网格层 + 场景氛围光场（慢速漂移 = Record Mode 的 ambient drift）+ 扫描光带 + 轻暗角 + 焦散噪点。
 * Phase 2.6：
 *   · 聚光响应：光场中心跟随 --spot-x/--spot-y（Director 模式由指针轻推，Record 恒为中心）。
 *   · 暗角减弱（0.66 → 0.46），边缘信息不再被吃掉。
 * 预算：纯 CSS 合成、无全屏 Canvas/WebGL、无 per-frame JS。
 */
export function AmbientBackground(): JSX.Element {
  const scene = useDirectorStore((s) => s.currentScene);
  const a = ATMOS[scene] ?? ATMOS.opening;
  const cinematic = readQuality();
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (grid) grid.style.opacity = cinematic ? "1" : "0.6";
  }, [cinematic]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={gridRef} className="ambient-grid absolute inset-0 transition-opacity duration-700" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="orb-drift depth-shift absolute" style={{ width: "68vmax", height: "68vmax", left: "-18%", top: "-22%", background: "radial-gradient(circle at 42% 42%, rgba(79,214,166,0.19), transparent 62%)", animation: "driftA 26s cubic-bezier(0.45,0,0.55,1) infinite" }} />
        <div className="orb-drift depth-shift absolute" style={{ width: "74vmax", height: "74vmax", right: "-24%", bottom: "-26%", background: "radial-gradient(circle at 58% 58%, rgba(127,173,214,0.18), transparent 62%)", animation: "driftB 32s cubic-bezier(0.45,0,0.55,1) infinite" }} />
        {a.warm && (
          <div className="orb-drift depth-shift absolute" style={{ width: "56vmax", height: "56vmax", right: "-10%", top: "-14%", background: "radial-gradient(circle at 50% 50%, " + a.warm + ", transparent 62%)", animation: "driftC 30s cubic-bezier(0.45,0,0.55,1) infinite" }} />
        )}
        <div className="absolute inset-0" style={{ background: "radial-gradient(120% 105% at var(--spot-x, 50%) var(--spot-y, 44%), " + a.base + ", transparent 60%)" }} />
      </div>
      {cinematic && (
        <div className="scan-sweep absolute inset-0">
          <div className="scan-bar" />
        </div>
      )}
      <div className="absolute inset-0" style={{ background: "radial-gradient(150% 132% at 50% 44%, transparent 58%, rgba(5,7,12,0.46) 100%)" }} />
      <div className="grain absolute inset-0" />
    </div>
  );
}
