import { useEffect, useRef } from "react";
import { useDirectorStore } from "../../stores/directorStore";
import type { SceneId } from "../../director/types";

/** 每个 Scene 的世界底色：让画面始终"活着"，但 opacity 极低、绝不抢业务信息 */
const ATMOS: Record<SceneId, { base: string; secondary: string; warm?: string }> = {
  opening: { base: "rgba(69,201,154,0.10)", secondary: "rgba(143,182,217,0.08)" },
  architecture: { base: "rgba(111,157,202,0.11)", secondary: "rgba(63,111,158,0.10)" },
  "hero-risk": { base: "rgba(111,157,202,0.11)", secondary: "rgba(143,182,217,0.09)", warm: "rgba(232,189,134,0.11)" },
  "hero-collaboration": { base: "rgba(69,201,154,0.10)", secondary: "rgba(111,157,202,0.10)" },
  "hero-reschedule": { base: "rgba(69,201,154,0.11)", secondary: "rgba(143,182,217,0.10)", warm: "rgba(232,189,134,0.07)" },
  "hero-insight": { base: "rgba(63,111,158,0.12)", secondary: "rgba(143,182,217,0.10)" },
  reliability: { base: "rgba(111,157,202,0.11)", secondary: "rgba(69,201,154,0.08)" },
  closing: { base: "rgba(69,201,154,0.10)", secondary: "rgba(143,182,217,0.07)" },
};

function readQuality(): "cinematic" | "balanced" {
  const q = new URLSearchParams(window.location.search).get("quality");
  return q === "cinematic" || q === "cinematic+record" ? "cinematic" : "balanced";
}

/**
 * AmbientBackground —— 全局唯一环境背景（Phase 2.5 重做）。
 * 由"黑布"升级为：网格层 + 场景氛围光场（慢速漂移） + 扫描光带 + 暗角 + 焦散噪点。
 * 预算：纯 CSS 合成（radial/linear）、无全屏 Canvas/WebGL、无 per-frame JS。
 * 读 ?quality=cinematic 时开启扫描光带；balanced 降低网格密度。
 */
export function AmbientBackground(): JSX.Element {
  const scene = useDirectorStore((s) => s.currentScene);
  const a = ATMOS[scene] ?? ATMOS.opening;
  const cinematic = readQuality();
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (grid) grid.style.opacity = cinematic ? "1" : "0.55";
  }, [cinematic]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={gridRef} className="ambient-grid absolute inset-0 transition-opacity duration-700" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="orb-drift absolute" style={{ width:"68vmax",height:"68vmax",left:"-18%",top:"-22%",background:"radial-gradient(circle at 42% 42%, rgba(69,201,154,0.16), transparent 62%)",animation:"driftA 26s cubic-bezier(0.45,0,0.55,1) infinite" }} />
        <div className="orb-drift absolute" style={{ width:"74vmax",height:"74vmax",right:"-24%",bottom:"-26%",background:"radial-gradient(circle at 58% 58%, rgba(111,157,202,0.15), transparent 62%)",animation:"driftB 32s cubic-bezier(0.45,0,0.55,1) infinite" }} />
        {a.warm && (
          <div className="orb-drift absolute" style={{ width:"56vmax",height:"56vmax",right:"-10%",top:"-14%",background:"radial-gradient(circle at 50% 50%, " + a.warm + ", transparent 62%)",animation:"driftC 30s cubic-bezier(0.45,0,0.55,1) infinite" }} />
        )}
        <div className="absolute inset-0" style={{ background:"radial-gradient(120% 105% at 50% -8%, " + a.base + ", transparent 60%)" }} />
      </div>
      {cinematic && (
        <div className="scan-sweep absolute inset-0">
          <div className="scan-bar" />
        </div>
      )}
      <div className="absolute inset-0" style={{ background:"radial-gradient(150% 132% at 50% 44%, transparent 54%, rgba(5,7,12,0.66) 100%)" }} />
      <div className="grain absolute inset-0" />
    </div>
  );
}
