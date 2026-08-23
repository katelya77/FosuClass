import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { BlurIn, RevealChars, RiseIn } from "../visual/TextFx";

interface SceneHeaderProps {
  kicker: string;
  title?: string;
  headline?: string;
  sub?: string;
  badge?: ReactNode;
  delay?: number;
  align?: "left" | "center";
  /** 主导标题字号：hero 用 42~64px 录屏标题带 */
  size?: "hero" | "headline" | "section";
}

/** 场景统一头部：kicker + 中文主标（逐字显影）+ 补充行 + 徽章 */
export function SceneHeader(props: SceneHeaderProps): JSX.Element {
  const main = props.headline ?? props.title;
  const align = props.align ?? "left";
  const centered = align === "center";
  const delay = props.delay ?? 0.12;
  const sizeClass = props.size === "hero" ? "t-hero" : props.size === "headline" ? "t-headline" : "t-section";
  return (
    <header className={cn("flex w-full items-end justify-between gap-8", centered && "flex-col items-center text-center")}>
      <div className={cn("min-w-0", centered && "mx-auto flex flex-col items-center")}>
        <RiseIn delay={delay}>
          <div className={cn("mb-3 flex items-center gap-3", centered && "justify-center")}>
            <span className="inline-block h-px w-9 bg-[var(--brand)] opacity-80" />
            <span className="t-kicker">{props.kicker}</span>
          </div>
        </RiseIn>
        {main ? (
          <RevealChars
            as="h2"
            text={main}
            delay={delay + 0.08}
            className={cn(sizeClass, centered && "justify-center")}
          />
        ) : null}
        {props.sub ? <BlurIn delay={delay + 0.42} className={cn("mt-3", centered && "mx-auto")}><p className="t-caption">{props.sub}</p></BlurIn> : null}
      </div>
      {props.badge ? <div className={cn("shrink-0 pb-1.5", centered && "mt-5")}>{props.badge}</div> : null}
    </header>
  );
}
