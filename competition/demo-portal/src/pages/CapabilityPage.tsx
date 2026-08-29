import type { ReactElement } from "react";
import {
  Calculator,
  CalendarCheck,
  Landmark,
  LayoutDashboard,
  School,
  Search,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

import { AgentBrandStrip } from "../components/AgentBrandStrip";
import { GlassSurface } from "../components/GlassSurface";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { type Route } from "../lib/router";

interface CapabilityPageProps {
  onNavigate: (route: Route) => void;
}

const ABILITIES: Array<{
  icon: LucideIcon;
  title: string;
  desc: string;
  accent: string;
  example: string;
}> = [
  {
    icon: CalendarCheck,
    title: "课表查询",
    desc: "想知道某位老师、某个班级怎么上课，说一句自然的话就能查到。",
    accent: "#d9593f",
    example: "教师025未来四周怎么上课？",
  },
  {
    icon: UsersRound,
    title: "多人协同",
    desc: "把几位老师的课表放在一起，自动算出共同空闲，并推荐合适的教室。",
    accent: "#c98a62",
    example: "帮教师005、006、014找共同空闲教室",
  },
  {
    icon: School,
    title: "调课模拟",
    desc: "先模拟一个新时间，再看是否可行，不会改动任何真实课表。",
    accent: "#d87c5f",
    example: "把这门课调整到周四7-8节是否可行？",
  },
  {
    icon: ShieldAlert,
    title: "教学风险",
    desc: "赶场、连堂、容量、冲突，小序会一项一项提醒你。",
    accent: "#b9674f",
    example: "教师025第1周有没有跨校区赶场？",
  },
  {
    icon: LayoutDashboard,
    title: "全校态势",
    desc: "看全校教师负载、教室使用和风险分布，一眼理解教学运行。",
    accent: "#a45a4b",
    example: "未来四周教师负载最高的是谁？",
  },
  {
    icon: ShieldCheck,
    title: "可核验的答案",
    desc: "每一条结果都来自确定性课表事实，而不是猜测。",
    accent: "#7b8f6a",
    example: "你能告诉我结果是怎么来的吗？",
  },
];

const JOURNEY = [
  { icon: Search, label: "查", text: "先从真实课表里找到你要的信息" },
  { icon: Calculator, label: "算", text: "再自动汇总负载、交集与可用性" },
  { icon: ShieldCheck, label: "验", text: "然后逐项核验冲突、容量与风险" },
  { icon: Landmark, label: "决策", text: "最后给出能直接用于判断的结论" },
];

export function CapabilityPage({ onNavigate }: CapabilityPageProps): ReactElement {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <div className="text-center">
        <p className="text-sm font-semibold tracking-[0.2em] text-brand">能力地图</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-balance text-3xl font-bold leading-tight text-ink sm:text-4xl">
          把校园教学安排，变成一句话能问的事
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-body">
          每一件事都从你熟悉的自然语言出发，小序负责查清、算准、验证，
          再给你一个可以放心使用的答案。
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {ABILITIES.map((ability, index) => {
          const Icon = ability.icon;
          return (
            <GlassSurface
              key={ability.title}
              delay={0.04 + index * 0.05}
              className="group p-6 sm:p-7"
            >
              <span
                className="flex size-12 items-center justify-center rounded-2xl border border-white/55 bg-white/42"
                style={{
                  color: ability.accent,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.82), 0 10px 20px rgba(90,44,32,0.1)",
                }}
              >
                <Icon size={22} />
              </span>
              <h2 className="mt-5 text-xl font-bold text-ink">{ability.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-body">{ability.desc}</p>
              <p className="mt-4 rounded-xl border border-white/35 bg-white/24 px-3 py-2 text-xs leading-relaxed text-body">
                例如：
                <span className="text-ink">{ability.example}</span>
              </p>
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
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-brand">多 Agent 协作</p>
            <h2 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">
              四个 Agent，与一层确定性校园事实
            </h2>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-body">
            主协调负责理解与汇总，三个领域 Agent 分工，CampusTools 负责核验事实。
          </p>
        </div>
        <AgentBrandStrip className="mt-7" />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="liquid-glass liquid-glass-glow mt-14 rounded-[30px] p-7 sm:p-10"
      >
        <div className="text-center">
          <p className="text-sm font-semibold tracking-[0.2em] text-brand">从问一句，到做判断</p>
          <h2 className="mt-3 text-2xl font-bold text-ink sm:text-3xl">小序的每一步</h2>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {JOURNEY.map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="relative rounded-2xl border border-white/40 bg-white/24 p-5">
                <span
                  className="flex size-11 items-center justify-center rounded-xl text-[#fff7f3]"
                  style={{
                    background: "linear-gradient(135deg, #e96d51 0%, #c44534 100%)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 7px 16px rgba(184,57,39,0.2)",
                  }}
                >
                  <Icon size={20} />
                </span>
                <p className="mt-4 text-lg font-bold text-ink">{item.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-body">{item.text}</p>
                {index < JOURNEY.length - 1 && (
                  <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-brand lg:block">
                    →
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <VerifiedBadge />
          <button
            onClick={() => onNavigate({ name: "experience" })}
            className="brand-button px-5 py-3 text-sm"
          >
            亲身体验一次
          </button>
        </div>
      </motion.section>
    </div>
  );
}
