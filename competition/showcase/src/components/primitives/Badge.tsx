import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "brand" | "risk" | "danger" | "stream";

const toneClass: Record<Tone, string> = {
  neutral: "",
  brand: "border-[color-mix(in_srgb,var(--brand)_38%,transparent)] text-brand",
  risk: "border-[color-mix(in_srgb,var(--risk)_42%,transparent)] text-riskc",
  danger: "border-[color-mix(in_srgb,var(--danger)_42%,transparent)] text-dangerc",
  stream: "border-[color-mix(in_srgb,var(--brand-secondary)_42%,transparent)] text-stream",
};

/** 状态徽章：图标 + 文本 + 色彩 三通道并行（可访问性要求） */
export function Badge({ icon, tone = "neutral", children }: { icon?: ReactNode; tone?: Tone; children: ReactNode }): JSX.Element {
  return (
    <span className={cn("chip", toneClass[tone])}>
      {icon}
      {children}
    </span>
  );
}
