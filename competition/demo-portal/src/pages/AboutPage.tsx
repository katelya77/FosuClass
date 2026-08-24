import type { ReactElement } from "react";
import { Compass, Heart, Sparkles, Users } from "lucide-react";
import { motion } from "motion/react";

import { AgentBrandStrip } from "../components/AgentBrandStrip";
import { BrandMark } from "../components/BrandMark";
import { GlassSurface } from "../components/GlassSurface";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { VERIFIED_COPY } from "../data/navigation";
import { type Route } from "../lib/router";

interface AboutPageProps {
  onNavigate: (route: Route) => void;
}

const VALUES = [
  {
    icon: Compass,
    title: "给教学多一双眼睛",
    desc: "把散落在课表里的安排，变成能提前发现、提前调整的线索。",
  },
  {
    icon: Users,
    title: "为每个人省时间",
    desc: "老师少跑几趟教务，辅导员少翻几份表格，管理者少做几次猜测。",
  },
  {
    icon: Heart,
    title: "让人更安心",
    desc: "每一个结论都有可核验的来源，不靠猜，也不藏着掖着。",
  },
];

export function AboutPage({ onNavigate }: AboutPageProps): ReactElement {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-[0.2em] text-brand">关于作品</p>
          <h1 className="mt-3 text-balance text-3xl font-bold leading-tight text-ink sm:text-4xl">
            让复杂的校园教学安排，简单到一句话就能问
          </h1>
          <p className="mt-5 text-pretty text-base leading-relaxed text-body">
            校园智序 · 小序是一个面向佛山大学师生的校园任务型 Agent。
            它不替代老师和管理者，而是帮他们把课表、教室、时间、风险这些
            很实在的问题，快速整理成清楚可用的信息。
          </p>
          <p className="mt-4 text-pretty text-base leading-relaxed text-body">
            这份演示站点是给评委、领导与老师的一次直接体验。你不需要理解
            什么 Agent、工具或流程，只要像平时说话一样提出问题，小序就会把
            答案和它背后的判断过程，一起交给你。
          </p>
        </div>

        <GlassSurface glow className="w-full p-7 lg:max-w-sm lg:shrink-0">
          <BrandMark size="md" />
          <p className="mt-5 text-sm leading-relaxed text-body">
            以确定性课表事实为底座，用清晰的判断路径，为校园教学运行提供可靠参照。
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <VerifiedBadge compact />
          </div>
          <div className="mt-5 border-t border-white/25 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mute">
              {VERIFIED_COPY.package} · {VERIFIED_COPY.badge}
            </p>
          </div>
        </GlassSurface>
      </div>

      <div className="mt-14 grid gap-5 sm:grid-cols-3">
        {VALUES.map((value, index) => {
          const Icon = value.icon;
          return (
            <GlassSurface key={value.title} delay={0.05 + index * 0.06} className="p-6 sm:p-7">
              <span
                className="flex size-11 items-center justify-center rounded-2xl border border-white/55 bg-white/42"
                style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.82), 0 9px 18px rgba(90,44,32,0.1)" }}
              >
                <Icon size={20} className="text-brand" />
              </span>
              <h2 className="mt-5 text-lg font-bold text-ink">{value.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-body">{value.desc}</p>
            </GlassSurface>
          );
        })}
      </div>

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="mt-14"
      >
        <div className="text-center">
          <p className="text-sm font-semibold tracking-[0.2em] text-brand">协作架构</p>
          <h2 className="mt-2 text-balance text-2xl font-bold text-ink sm:text-3xl">
            一群各司其职的校园智能体
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-body">
            它们共享同一套确定性课表事实，不靠猜测，也不越权改写真实安排。
          </p>
        </div>
        <AgentBrandStrip className="mt-7" />
      </motion.section>

      <div className="liquid-glass mt-14 flex flex-col items-center gap-5 rounded-[30px] p-8 text-center sm:p-10">
        <span
          className="flex size-16 items-center justify-center rounded-2xl"
          style={{
            background: "linear-gradient(135deg, #e96d51 0%, #c44534 100%)",
            boxShadow: "0 12px 30px rgba(184,57,39,0.3), inset 0 1px 0 rgba(255,255,255,0.5)",
          }}
        >
          <Sparkles size={26} className="text-[#fff7f3]" />
        </span>
        <h2 className="text-balance text-2xl font-bold text-ink sm:text-3xl">
          现在，就试着问一句
        </h2>
        <p className="max-w-xl text-pretty text-sm leading-relaxed text-body">
          不用注册，不用学习参数，直接开始一次真实的小序体验。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => onNavigate({ name: "experience" })}
            className="brand-button px-5 py-3 text-sm"
          >
            问问小序
          </button>
          <button
            onClick={() => onNavigate({ name: "cases" })}
            className="glass-button px-5 py-3 text-sm"
          >
            先看演示案例
          </button>
        </div>
      </div>
    </div>
  );
}
