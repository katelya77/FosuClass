import { useEffect, useRef } from "react";

/**
 * 全局唯一的环境背景：单 Canvas 点阵（Dot Grid 方向，React Bits 同类视觉的轻量自绘）
 * + 两团极低透明度的品牌色 radial 光晕 + 暗角。
 * 性能预算：1 个 Canvas / 无 WebGL / 无 blur filter；reduced-motion 时只画一帧。
 */
export function AmbientBackground(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = true;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const GAP = 34 * dpr;
    const drawFrame = (t: number) => {
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      const driftX = reduced ? 0 : Math.sin(t * 0.00006) * 8 * dpr;
      const driftY = reduced ? 0 : Math.cos(t * 0.00005) * 6 * dpr;
      ctx.fillStyle = "#93A1B1";
      const startY = ((driftY % GAP) + GAP) % GAP;
      const startX = ((driftX % GAP) + GAP) % GAP;
      for (let y = startY; y < h; y += GAP) {
        for (let x = startX; x < w; x += GAP) {
          const wave = Math.sin(x * 0.006 + y * 0.004 + t * 0.0004);
          ctx.globalAlpha = reduced ? 0.07 : 0.05 + wave * 0.018;
          ctx.fillRect(x, y, 1.3 * dpr, 1.3 * dpr);
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      if (!running) return;
      drawFrame(t);
      raf = requestAnimationFrame(loop);
    };

    if (reduced) {
      drawFrame(0);
    } else {
      raf = requestAnimationFrame(loop);
      const onVis = () => {
        if (document.hidden) {
          running = false;
          cancelAnimationFrame(raf);
        } else if (!running) {
          running = true;
          raf = requestAnimationFrame(loop);
        }
      };
      document.addEventListener("visibilitychange", onVis);
      return () => {
        running = false;
        cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("resize", resize);
      };
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      {/* 品牌色光晕：青绿左上 × 低饱和蓝右下，透明度压到「几乎察觉不到但确实存在」 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1150px 720px at 12% 6%, rgba(70,199,154,0.075), transparent 62%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1300px 800px at 88% 96%, rgba(111,153,197,0.07), transparent 60%)",
        }}
      />
      {/* 暗角 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(145% 125% at 50% 42%, transparent 52%, rgba(7,9,13,0.6) 100%)",
        }}
      />
    </div>
  );
}
