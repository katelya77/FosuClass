import { useEffect, useState } from "react";
import {
  Calculator,
  Landmark,
  Search,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "../lib/cn";
import { MagneticButton } from "./MagneticButton";

type DemoStep = {
  key: "query" | "compute" | "verify" | "decide";
  number: string;
  label: string;
  title: string;
  detail: string;
  icon: LucideIcon;
  bullets: string[];
};

const STEPS: DemoStep[] = [
  {
    key: "query",
    number: "01",
    label: "查",
    title: "查",
    detail: "从真实课表里快速找到教师025的未来四周安排",
    icon: Search,
    bullets: ["教师025 · 大学英语", "第 1-4 周", "56 节 / 112 学时"],
  },
  {
    key: "compute",
    number: "02",
    label: "算",
    title: "算",
    detail: "自动汇总负载，定位最忙的教师与潜在风险",
    icon: Calculator,
    bullets: ["Top1 教师025 · 112 学时", "每周稳定 14 节", "无排课冲突"],
  },
  {
    key: "verify",
    number: "03",
    label: "验",
    title: "验",
    detail: "逐项核验跨校区赶场、容量与可用性",
    icon: ShieldCheck,
    bullets: ["冲突 0", "赶场预警 4 次", "最短间隔 20 分钟"],
  },
  {
    key: "decide",
    number: "04",
    label: "决策",
    title: "决策",
    detail: "把校园信息变成能直接辅助决策的理解",
    icon: Landmark,
    bullets: ["从查询校园信息", "到理解教学运行", "并辅助决策"],
  },
];

export const GUIDED_DEMO_STEP_DURATION = 2800;

interface GuidedDemoProps {
  open: boolean;
  onClose: () => void;
  onReplay?: () => void;
}

export function GuidedDemo({ open, onClose, onReplay }: GuidedDemoProps): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setFinished(false);
  }, [open]);

  useEffect(() => {
    if (!open || finished) return;
    const timer = window.setTimeout(() => {
      if (index < STEPS.length - 1) {
        setIndex((value) => value + 1);
      } else {
        setFinished(true);
      }
    }, GUIDED_DEMO_STEP_DURATION);
    return () => window.clearTimeout(timer);
  }, [finished, index, open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const replay = () => {
    setIndex(0);
    setFinished(false);
    onReplay?.();
  };

  const selectStep = (stepIndex: number) => {
    setIndex(stepIndex);
    setFinished(false);
  };

  const step = STEPS[index];
  const StepIcon = step.icon;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="guided"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="demo-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-8"
          aria-modal="true"
          role="dialog"
          aria-label="比赛演示模式"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="gradient-blob animate-drift left-[10%] top-[8%] size-72 bg-rose/60" />
            <span className="gradient-blob animate-drift-slow right-[8%] top-[52%] size-80 bg-lavender/70" />
            <span className="gradient-blob animate-float bottom-[6%] left-[42%] size-64 bg-peach/70" />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="demo-stage liquid-glass liquid-glass-glow relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[32px]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/30 px-6 py-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-9 items-center justify-center rounded-xl bg-white/48"
                  style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 8px 18px rgba(90,44,32,0.12)" }}
                >
                  <Landmark size={17} className="text-brand" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">比赛演示模式</p>
                  <p className="text-[11px] text-mute">自动走完查、算、验、决策</p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="关闭比赛演示"
                className="glass-button flex size-9 items-center justify-center rounded-full p-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className="relative min-h-[320px] flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={finished ? "finished" : step.key}
                  initial={{ opacity: 0, x: 46 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -46 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 flex flex-col items-center justify-center px-7 py-8 text-center sm:px-14"
                  aria-live="polite"
                >
                  {!finished ? (
                    <>
                      <span
                        className="relative flex size-20 items-center justify-center rounded-[26px] border border-white/65 bg-white/45"
                        style={{
                          boxShadow:
                            "inset 0 1px 0 rgba(255,255,255,0.9), 0 22px 46px rgba(90,44,32,0.16), 0 0 34px rgba(217,89,63,0.16)",
                        }}
                      >
                        <span className="shimmer-overlay shimmer-on" />
                        <StepIcon size={34} className="relative z-10 text-brand" />
                      </span>
                      <p className="mt-5 text-sm font-semibold tracking-[0.24em] text-brand">
                        {step.number} · {step.label}
                      </p>
                      <h2 className="mt-2 text-3xl font-bold text-ink sm:text-4xl">{step.title}</h2>
                      <p className="mt-3 max-w-[32em] text-sm leading-relaxed text-body sm:text-base">
                        {step.detail}
                      </p>
                      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                        {step.bullets.map((bullet) => (
                          <span
                            key={bullet}
                            className="rounded-full border border-white/60 bg-white/38 px-4 py-2 text-xs font-medium text-body backdrop-blur-md"
                            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)" }}
                          >
                            {bullet}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex max-w-xl flex-col items-center">
                      <span
                        className="flex size-16 items-center justify-center rounded-2xl"
                        style={{
                          background: "linear-gradient(135deg, #e96d51 0%, #c44534 100%)",
                          boxShadow: "0 12px 30px rgba(184,57,39,0.3), inset 0 1px 0 rgba(255,255,255,0.5)",
                        }}
                      >
                        <Landmark size={28} className="text-[#fff7f3]" />
                      </span>
                      <h2 className="mt-5 text-balance text-2xl font-bold leading-snug text-ink sm:text-3xl">
                        从查询校园信息，
                        <br />
                        到理解教学运行并辅助决策。
                      </h2>
                      <p className="mt-3 max-w-[30em] text-sm leading-relaxed text-body">
                        这就是小序，把复杂课表变成一句可以回答的安排。
                      </p>
                      <MagneticButton
                        variant="brand"
                        className="mt-7 px-6 py-3 text-sm"
                        onClick={replay}
                      >
                        重新播放
                      </MagneticButton>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="border-t border-white/30 px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-1 items-center gap-1.5">
                  {STEPS.map((item, stepIndex) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => selectStep(stepIndex)}
                      aria-label={`跳到${item.label}`}
                      aria-current={!finished && stepIndex === index ? "step" : undefined}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-all",
                        stepIndex <= index ? "bg-white/55 text-brand-deep" : "text-mute bg-white/20",
                      )}
                      style={
                        stepIndex === index
                          ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 4px 12px rgba(217,89,63,0.16)" }
                          : undefined
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <span className="shrink-0 text-[11px] font-medium text-mute">
                  {finished ? "完成" : `${index + 1} / ${STEPS.length}`}
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/30">
                <motion.div
                  key={`${index}:${finished ? "finished" : "running"}`}
                  className="h-full rounded-full bg-gradient-to-r from-brand-soft to-brand"
                  initial={{ width: `${finished ? 100 : (index / STEPS.length) * 100}%` }}
                  animate={{ width: `${finished ? 100 : ((index + 1) / STEPS.length) * 100}%` }}
                  transition={{ duration: finished ? 0.25 : GUIDED_DEMO_STEP_DURATION / 1000, ease: "linear" }}
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
