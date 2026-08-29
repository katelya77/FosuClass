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

/** 场景统一头部：元信息与徽章同排，中文主标独占完整宽度，避免窄屏互相挤压。 */
export function SceneHeader(props: SceneHeaderProps): JSX.Element {
  const main = props.headline ?? props.title;
  const align = props.align ?? "left";
  const centered = align === "center";
  const delay = props.delay ?? 0.12;
  const sizeClass = props.size === "hero" ? "t-hero" : props.size === "headline" ? "t-headline" : "t-section";
  return (
    <header className={cn("flex w-full min-w-0 flex-col", centered && "items-center text-center")}>
      <div className={cn("mb-3 flex w-full min-w-0 items-center justify-between gap-6", centered && "justify-center")}>
        <RiseIn delay={delay}>
          <div className={cn("flex items-center gap-3", centered && "justify-center")}>
            <span className="inline-block h-px w-9 bg-[var(--brand)] opacity-80" />
            <span className="t-kicker">{props.kicker}</span>
          </div>
        </RiseIn>
        {props.badge ? <div className={cn("shrink-0", centered && "hidden")}>{props.badge}</div> : null}
      </div>
      <div className={cn("min-w-0 max-w-full", centered && "mx-auto flex flex-col items-center")}>
        {main ? (
          <RevealChars
            as="h2"
            text={main}
            delay={delay + 0.08}
            stagger={0.014}
            className={cn(sizeClass, "max-w-full", centered && "justify-center")}
          />
        ) : null}
        {props.sub ? <BlurIn delay={delay + 0.42} className={cn("mt-3", centered && "mx-auto")}><p className="t-caption">{props.sub}</p></BlurIn> : null}
      </div>
      {props.badge && centered ? <div className="mt-5">{props.badge}</div> : null}
    </header>
  );
}
