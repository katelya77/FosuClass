import { useState, type FormEvent, type ReactElement } from "react";
import { ArrowUpRight, CornerDownLeft, Play, Sparkles } from "lucide-react";
import { motion } from "motion/react";

import { AgentBrandStrip } from "../components/AgentBrandStrip";
import { BrandMark } from "../components/BrandMark";
import { MagneticButton } from "../components/MagneticButton";
import { SpotlightCard } from "../components/SpotlightCard";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { AGENT_BRANDS, CHAT_BACKGROUND } from "../data/branding";
import { EXPERIENCE_CASES } from "../data/cases";
import { setPendingPrompt } from "../lib/pending";
import { type Route } from "../lib/router";

interface HomePageProps {
  onNavigate: (route: Route) => void;
  onQuickDemo?: () => void;
}

const CASE_BRAND = {
  query: "course",
  collaboration: "coordinator",
  reschedule: "risk",
  insight: "insight",
} as const;

export function HomePage({ onNavigate, onQuickDemo }: HomePageProps): ReactElement {
  const [question, setQuestion] = useState("");
  const coordinator = AGENT_BRANDS[0];

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    setPendingPrompt(trimmed || EXPERIENCE_CASES[0].fullPrompt);
    onNavigate({ name: "experience", caseKey: "query" });
  };

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-20 sm:px-7 sm:pb-24">
      <section className="home-hero relative isolate mt-4 overflow-hidden rounded-[34px] sm:mt-7 sm:rounded-[44px]">
        <img
          src={CHAT_BACKGROUND.image}
          alt=""
          aria-hidden
          className="absolute inset-0 -z-20 h-full w-full object-cover opacity-70"
        />
        <span className="home-hero-wash absolute inset-0 -z-10" aria-hidden />

        <div className="home-hero-copy">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="hidden sm:block"
          >
            <BrandMark size="md" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20, filter: "blur(7px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.08, duration: 0.78, ease: [0.22, 1, 0.36, 1] }}
            className="text-balance mt-4 max-w-[760px] text-[clamp(2.5rem,5.2vw,5.5rem)] font-bold leading-[1.06] tracking-[-0.055em] text-ink sm:mt-8"
          >
            说一句话，<br />
            <span className="home-hero-emphasis">校园教学安排</span>
            <br />就清楚了。
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="mt-4 max-w-[630px] text-base leading-relaxed text-body sm:mt-6 sm:text-lg"
          >
            不用懂智能体，也不用找系统入口。直接告诉小序你想知道什么，它会把查询、核验和结论讲清楚。
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-white/55 px-4 py-2 text-sm font-semibold text-brand-deep shadow-[0_8px_24px_rgba(183,68,48,0.12)] sm:hidden"
          >
            <Sparkles size={16} />
            问问小序
          </motion.div>

          <motion.form
            onSubmit={submitQuestion}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
            className="liquid-glass liquid-glass-glow mt-3 flex w-full max-w-[720px] items-center gap-2 rounded-[28px] p-2 sm:mt-8 sm:rounded-full"
          >
            <span className="ml-2 hidden shrink-0 items-center gap-2 rounded-full bg-white/55 px-3 py-2 text-xs font-semibold text-brand-deep sm:flex">
              <Sparkles size={15} />
              问问小序
            </span>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：教师025未来四周怎么上课？"
              aria-label="想向小序问什么"
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base text-ink placeholder:text-mute sm:text-lg focus:outline-none"
            />
            <MagneticButton variant="brand" type="submit" className="shrink-0 px-5 py-3 text-sm sm:px-7" ariaLabel="把这个问题交给小序">
              <span>开始</span>
              <CornerDownLeft size={17} />
            </MagneticButton>
          </motion.form>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.44, duration: 0.65 }}
            className="mt-5 flex flex-wrap items-center gap-3"
          >
            <VerifiedBadge compact />
            <button onClick={onQuickDemo} className="glass-button px-4 py-2 text-xs sm:text-sm">
              <Play size={14} className="text-brand" />
              先看 60 秒演示
            </button>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9, x: 24 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ delay: 0.18, duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
          className="home-agent-stage"
        >
          <span className="home-agent-halo" aria-hidden />
          <span className="home-agent-orbit home-agent-orbit-a">理解问题</span>
          <span className="home-agent-orbit home-agent-orbit-b">协调查询</span>
          <span className="home-agent-orbit home-agent-orbit-c">核验结论</span>
          <div className="home-agent-jelly">
            <span className="home-agent-shine" aria-hidden />
            <img src={coordinator.image} alt={coordinator.name} className="h-full w-full object-contain" />
          </div>
          <p className="mt-5 text-center text-sm font-semibold tracking-[0.16em] text-brand-deep">小序 · 校园教学任务助手</p>
        </motion.div>
      </section>

      <section className="mt-8 sm:mt-12">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-brand">一键体验</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">选一句你真正会问的话</h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-body">点击任意场景，直接带着问题和上下文进入真实体验。</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {EXPERIENCE_CASES.map((item, index) => {
            const brand = AGENT_BRANDS.find((entry) => entry.id === CASE_BRAND[item.key]) ?? coordinator;
            return (
              <SpotlightCard
                key={item.key}
                tilt
                onClick={() => onNavigate({ name: "experience", caseKey: item.key })}
                accent={item.accent}
                delay={0.04 + index * 0.06}
                className="scenario-jelly h-full cursor-pointer p-5 sm:p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <img src={brand.image} alt="" aria-hidden className="size-16 rounded-[20px] object-contain drop-shadow-[0_12px_22px_rgba(143,47,34,0.2)]" />
                  <span className="rounded-full bg-white/46 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-mute">0{index + 1}</span>
                </div>
                <h3 className="mt-5 text-xl font-bold text-ink">{item.title}</h3>
                <p className="mt-2 min-h-[3rem] text-sm leading-relaxed text-body">{item.shortPrompt}</p>
                <div className="mt-6 flex items-center justify-between border-t border-white/45 pt-4 text-sm font-semibold text-brand-deep">
                  <span>带着问题进入</span>
                  <ArrowUpRight size={17} />
                </div>
              </SpotlightCard>
            );
          })}
        </div>
      </section>

      <section className="brand-relationship mt-12 overflow-hidden rounded-[34px] p-5 sm:mt-20 sm:p-8 lg:p-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-brand">协同，而不是黑盒</p>
            <h2 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">四个角色理解任务，CampusTools 核验事实</h2>
          </div>
          <button onClick={() => onNavigate({ name: "capability" })} className="glass-button w-fit px-4 py-2 text-sm">
            看懂它怎样工作 <ArrowUpRight size={15} />
          </button>
        </div>
        <AgentBrandStrip className="mt-7" compact />
      </section>
    </div>
  );
}
