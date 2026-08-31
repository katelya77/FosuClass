import { useEffect, useState, type ReactElement } from "react";
import {
  BadgeCheck,
  ChevronRight,
  CircleX,
  Lightbulb,
  Play,
  Search,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { AgentBrandStrip } from "../components/AgentBrandStrip";
import { SpotlightCard } from "../components/SpotlightCard";
import { STORY_CARDS, type StoryCard, type StoryFlow } from "../data/stories";
import { type Route } from "../lib/router";

interface CasesPageProps {
  onNavigate: (route: Route) => void;
}

function FlowChips({ flow }: { flow: StoryFlow[] }): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {flow.map((item, index) => (
        <motion.span
          key={`${item.label}-${index}`}
          initial={{ opacity: 0, x: -6, scale: 0.92 }}
          whileInView={{ opacity: 1, x: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ delay: index * 0.12, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flow-chip"
        >
          {item.value ? (
            <>
              <span className="text-mute">{item.label}</span>
              <strong>{item.value}</strong>
            </>
          ) : (
            <strong>{item.label}</strong>
          )}
        </motion.span>
      ))}
    </div>
  );
}

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: typeof Search;
  children: React.ReactNode;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-mute">
      <Icon size={13} />
      {children}
    </span>
  );
}

export function CasesPage({ onNavigate }: CasesPageProps): ReactElement {
  const [replay, setReplay] = useState<StoryCard | null>(null);
  const [replayStep, setReplayStep] = useState(0);

  useEffect(() => {
    if (!replay) return;
    setReplayStep(0);
    const showExecution = window.setTimeout(() => setReplayStep(1), 900);
    const showResult = window.setTimeout(() => setReplayStep(2), 1800);
    return () => {
      window.clearTimeout(showExecution);
      window.clearTimeout(showResult);
    };
  }, [replay]);

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-[0.2em] text-brand">已核验案例</p>
          <h1 className="mt-2 max-w-2xl text-balance text-3xl font-bold leading-tight text-ink sm:text-4xl">
            四个案例，四次已核验的完整决策
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-body">
            每个案例都从一句自然的提问开始，小序先查、再算、后验，
            最后给你能直接用来做判断的答案。
          </p>
        </div>
        <button
          onClick={() => onNavigate({ name: "experience" })}
          className="brand-button shrink-0 px-5 py-3 text-sm"
        >
          <Sparkles size={16} />
          进入真实体验
        </button>
      </div>

      <div className="liquid-glass mt-8 flex flex-col gap-2.5 rounded-3xl p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-body">
          以下案例均来自同一份匿名演示数据，并配有
          <strong className="text-ink"> 已核验演示回放（非实时）</strong>
          ；点击任意案例，可在“真实体验”中现场发起同样的任务。
        </p>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1.5 text-[11px] font-semibold text-brand-deep">
          <BadgeCheck size={13} />
          已核验演示回放 · 非实时
        </span>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {STORY_CARDS.map((story, index) => (
          <SpotlightCard
            key={story.key}
            delay={0.04 + index * 0.05}
            accent={story.accent}
            className="h-full cursor-pointer p-6 sm:p-7"
            onClick={() => setReplay(story)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-11 items-center justify-center rounded-2xl border border-white/55 bg-white/42"
                  style={{
                    color: story.accent,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.82), 0 9px 18px rgba(90,44,32,0.1)",
                  }}
                >
                  {index === 0 ? <Search size={20} /> : <Lightbulb size={20} />}
                </span>
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-mute">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h2 className="text-xl font-bold text-ink">{story.title}</h2>
                </div>
              </div>
              <ChevronRight size={20} className="text-brand" />
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <SectionLabel icon={Search}>问题是什么</SectionLabel>
                <p className="mt-2 text-base font-medium leading-relaxed text-ink">{story.problem}</p>
              </div>

              <div>
                <SectionLabel icon={Sparkles}>小序做了什么</SectionLabel>
                <p className="mt-2 text-sm leading-relaxed text-body">{story.action}</p>
              </div>

              <div className="rounded-2xl border border-white/35 bg-white/22 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-mute">完整路径</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2.5 py-1 text-[10px] font-semibold text-brand-deep">
                    <BadgeCheck size={12} />
                    已核验
                  </span>
                </div>
                <FlowChips flow={story.flow} />
              </div>

              <div>
                <SectionLabel icon={Lightbulb}>最后得到什么</SectionLabel>
                <p className="mt-2 text-sm leading-relaxed text-body">{story.outcome}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-1.5 border-t border-white/25 pt-4">
              {story.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-white/50 bg-white/28 px-2.5 py-1 text-[10px] font-medium text-mute"
                >
                  <BadgeCheck size={11} />
                  {tag}
                </span>
              ))}
            </div>
          </SpotlightCard>
        ))}
      </div>

      <AnimatePresence>
        {replay && (
          <motion.div
            className="fixed inset-0 z-[80] grid place-items-center bg-[#261d19]/35 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setReplay(null)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label={`${replay.title}已核验演示回放`}
              className="liquid-glass relative w-full max-w-4xl overflow-hidden rounded-[32px] p-6 sm:p-9"
              initial={{ opacity: 0, y: 28, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setReplay(null)}
                className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border border-white/50 bg-white/35 text-mute transition hover:bg-white/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                aria-label="关闭演示回放"
              >
                <CircleX size={19} />
              </button>

              <div className="pr-12">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1.5 text-[11px] font-semibold text-brand-deep">
                  <BadgeCheck size={13} />
                  已核验演示回放 · 非实时
                </span>
                <h2 className="mt-4 text-2xl font-bold text-ink sm:text-3xl">{replay.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-body">不用等待模型，先看清问题怎样一步步变成结果。</p>
              </div>

              <div className="mt-7 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
                {[
                  { label: "问题", text: replay.problem, color: "#d9593f" },
                  { label: "执行", text: replay.action, color: "#c98a62" },
                  { label: "结果", text: replay.outcome, color: "#237f69" },
                ].map((item, index) => (
                  <div key={item.label} className="contents">
                    <motion.div
                      className="rounded-3xl border border-white/55 bg-white/32 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]"
                      initial={false}
                      animate={{ opacity: replayStep >= index ? 1 : 0.25, y: replayStep >= index ? 0 : 10 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <p className="text-[11px] font-semibold tracking-[0.18em]" style={{ color: item.color }}>{item.label}</p>
                      <p className="mt-3 text-base font-semibold leading-relaxed text-ink">{item.text}</p>
                    </motion.div>
                    {index < 2 && (
                      <motion.div
                        aria-hidden
                        className="hidden self-center text-2xl font-light text-brand lg:block"
                        initial={false}
                        animate={{ opacity: replayStep > index ? 1 : 0.18, x: replayStep > index ? 0 : -8 }}
                      >
                        →
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-white/45 bg-white/24 p-4">
                <p className="text-[11px] font-semibold tracking-[0.16em] text-mute">核验路径</p>
                <div className="mt-3"><FlowChips flow={replay.flow} /></div>
              </div>

              <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-xs leading-relaxed text-mute">这是同一份匿名演示数据的固定回放，不伪装成实时请求。</p>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: "experience", caseKey: replay.key })}
                  className="brand-button px-5 py-3 text-sm"
                >
                  <Play size={15} />
                  进入真实体验
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="liquid-glass mt-14 rounded-[30px] p-7 sm:p-10"
      >
        <div className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-brand">背后的协作组</p>
            <h2 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">
              四个案例，不只是一次调用
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-body">
            主协调 Agent 组装任务，风险、洞察与课程空间 Agent 分别核验，
            最终由 CampusTools 插件把结果拉回确定性课表。
          </p>
        </div>
        <AgentBrandStrip className="mt-7" />
      </motion.section>
    </div>
  );
}
