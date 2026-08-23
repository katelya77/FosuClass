/*
 * 基于 React Bits ElectricBorder（David Haz © 2026，MIT + Commons Clause）深度改造。
 * 上游：DavidHDev/react-bits @ 4e0e030193b563be6be33d928f77d0d01cefe237（src/ts-tailwind）。
 * 本地改造：新增 active 支持——非活动或 reduced-motion 时完全暂停 rAF（§33 离屏零功耗），
 * 仅保留静态描边；全项目仅允许在 Reschedule 候选收敛高潮使用一次。
 * 完整清单见 docs/REACT-BITS-USAGE.md。
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";

function hexToRgba(hex: string, alpha = 1): string {
  if (!hex) return "rgba(0,0,0," + alpha + ")";
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h.slice(0, 6), 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

export interface ElectricBorderProps {
  children?: ReactNode;
  color?: string;
  speed?: number;
  chaos?: number;
  borderRadius?: number;
  /** false 时停止动画循环并显示静态描边 */
  active?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function ElectricBorder({
  children,
  color = "#46c79a",
  speed = 1,
  chaos = 0.12,
  borderRadius = 24,
  active = true,
  className,
  style,
}: ElectricBorderProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const reduce = useReducedMotion();
  const running = active && !reduce;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !running) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const random = (x: number): number => (Math.sin(x * 12.9898) * 43758.5453) % 1;
    const noise2D = (x: number, y: number): number => {
      const i = Math.floor(x);
      const j = Math.floor(y);
      const fx = x - i;
      const fy = y - j;
      const a = random(i + j * 57);
      const b = random(i + 1 + j * 57);
      const c = random(i + (j + 1) * 57);
      const d = random(i + 1 + (j + 1) * 57);
      const ux = fx * fx * (3.0 - 2.0 * fx);
      const uy = fy * fy * (3.0 - 2.0 * fy);
      return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
    };
    const octavedNoise = (
      x: number, octaves: number, lacunarity: number, gain: number,
      amplitude: number, frequency: number, time: number, seed: number, baseFlatness: number,
    ): number => {
      let y = 0;
      let amp = amplitude;
      let freq = frequency;
      for (let o = 0; o < octaves; o++) {
        if (o === 0) y += amp * baseFlatness;
        y += amp * noise2D(freq * x + seed * 100, time * freq * 0.3);
        freq *= lacunarity;
        amp *= gain;
      }
      return y;
    };
    const getCornerPoint = (cx: number, cy: number, radius: number, startAngle: number, arcLength: number, progress: number) => {
      const angle = startAngle + progress * arcLength;
      return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    };
    const roundedPoint = (t: number, left: number, top: number, width: number, height: number, radius: number) => {
      const straightWidth = width - 2 * radius;
      const straightHeight = height - 2 * radius;
      const cornerArc = (Math.PI * radius) / 2;
      const total = 2 * straightWidth + 2 * straightHeight + 4 * cornerArc;
      let dist = ((t % 1) + 1) % 1 * total;
      if (dist <= straightWidth) return { x: left + radius + dist, y: top };
      dist -= straightWidth;
      if (dist <= cornerArc) return getCornerPoint(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2, dist / cornerArc);
      dist -= cornerArc;
      if (dist <= straightHeight) return { x: left + width, y: top + radius + dist };
      dist -= straightHeight;
      if (dist <= cornerArc) return getCornerPoint(left + width - radius, top + height - radius, radius, 0, Math.PI / 2, dist / cornerArc);
      dist -= cornerArc;
      if (dist <= straightWidth) return { x: left + width - radius - dist, y: top + height };
      dist -= straightWidth;
      if (dist <= cornerArc) return getCornerPoint(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI / 2, dist / cornerArc);
      dist -= cornerArc;
      if (dist <= straightHeight) return { x: left, y: top + height - radius + dist };
      dist -= straightHeight;
      if (dist <= cornerArc) return getCornerPoint(left + radius, top + radius, radius, Math.PI, Math.PI / 2, dist / cornerArc);
      dist -= cornerArc;
      return { x: left + radius + dist, y: top };
    };

    const displacement = 60;
    const borderOffset = 60;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = rect.width + borderOffset * 2;
      const height = rect.height + borderOffset * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width, height };
    };

    let size = resize();
    const onResize = () => { size = resize(); };
    window.addEventListener("resize", onResize);

    const draw = (now: number) => {
      const dt = Math.min((now - (lastFrameTimeRef.current || now)) / 1000, 0.05);
      lastFrameTimeRef.current = now;
      timeRef.current += dt * speed;
      ctx.clearRect(0, 0, size.width, size.height);
      const t = timeRef.current;
      for (const pass of [0, 1]) {
        const amplitude = chaos * (pass === 0 ? 1.6 : 0.9);
        const lineWidth = pass === 0 ? 3 : 1.4;
        const alpha = pass === 0 ? 0.5 : 0.95;
        ctx.beginPath();
        const steps = 200;
        for (let s = 0; s <= steps; s++) {
          const pt = roundedPoint(s / steps, borderOffset, borderOffset, size.width - borderOffset * 2, size.height - borderOffset * 2, borderRadius);
          const n1 = octavedNoise(s * 0.35 + pass * 100, 10, 1.6, 0.7, amplitude, 10, t, pass * 7, 0);
          const n2 = octavedNoise(s * 0.35 + 400 + pass * 100, 10, 1.6, 0.7, amplitude, 10, t, pass * 13, 0);
          const x = pt.x + (n1 - 0.5) * displacement * 0.22;
          const y = pt.y + (n2 - 0.5) * displacement * 0.22;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = hexToRgba(color, alpha);
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
      animationRef.current = requestAnimationFrame(draw);
    };
    animationRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", onResize);
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [running, chaos, speed, color, borderRadius]);

  return (
    <div ref={containerRef} className={"relative overflow-hidden " + (className ?? "")} style={{ ...style, borderRadius }} data-electric={running ? "on" : "off"}>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: -60, top: -60, zIndex: 2, opacity: running ? 1 : 0.3 }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ borderRadius, boxShadow: "inset 0 0 0 1px " + hexToRgba(color, running ? 0.8 : 0.45), zIndex: 3 }}
      />
      <div style={{ position: "relative", zIndex: 4 }}>{children}</div>
    </div>
  );
}