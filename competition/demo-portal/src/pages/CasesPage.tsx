import type { ReactElement } from "react";
import {
  BadgeCheck,
  ChevronRight,
  Lightbulb,
  Search,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";

import { AgentBrandStrip } from "../components/AgentBrandStrip";
import { SpotlightCard } from "../components/SpotlightCard";
import { STORY_CARDS, type StoryFlow } from "../data/stories";
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
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-[0.2em] text-brand">演示案例</p>
          <h1 className="mt-2 max-w-2xl text-balance text-3xl font-bold leading-tight text-ink sm:text-4xl">
            四个问题，四次完整决策
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
          开始体验
        </button>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {STORY_CARDS.map((story, index) => (
          <SpotlightCard
            key={story.key}
            delay={0.04 + index * 0.05}
            accent={story.accent}
            className="h-full cursor-pointer p-6 sm:p-7"
            onClick={() => onNavigate({ name: "experience", caseKey: story.key })}
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
                    Verified
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
              四个问题，不只是一次调用
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
