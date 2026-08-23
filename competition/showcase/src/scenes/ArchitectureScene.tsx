import { motion } from "motion/react";
import { BarChart3, GraduationCap, LayoutGrid, Network, ShieldAlert, UserRound, Wrench } from "lucide-react";
import { SceneHeader } from "../components/primitives/SceneHeader";
import { Badge } from "../components/primitives/Badge";
import { rise } from "../components/primitives/motion";

const TOOL_SHORT_NAMES = [
  "schedule_query",
  "schedule_range_query",
  "classroom_search",
  "entity_search",
  "academic_context",
  "common_free_time_query",
  "group_plan",
  "risk_check",
  "day_plan",
  "reschedule_feasibility",
  "overview",
  "teacher_load_query",
  "room_utilization_query",
];

function Connector({ delay }: { delay: number }): JSX.Element {
  return (
    <motion.div
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="mx-1 h-px min-w-6 flex-1 origin-left bg-line-strong"
    />
  );
}

/** 架构场景：主编排 → 三域 Agent → CampusTools → 统一结果卡（真实拓扑，零虚构） */
export function ArchitectureScene(): JSX.Element {
  return (
    <div className="stage-safe flex w-full flex-col gap-8">
      <SceneHeader
        kicker="系统架构"
        title="一个主编排 · 三个领域智能体 · 一套工具事实层"
        badge={<Badge tone="brand" icon={<Network size={14} />}>Multi-Agent</Badge>}
      />

      <div className="flex min-h-0 flex-1 items-stretch gap-1">
        {/* 用户输入 */}
        <motion.div {...rise(0.6)} className="panel-raised flex w-[190px] flex-col items-center justify-center gap-3 text-center">
          <UserRound size={26} className="text-stream" />
          <div>
            <p className="t-card-title">用户输入</p>
            <p className="t-caption mt-1">自然语言校园任务</p>
          </div>
        </motion.div>

        <Connector delay={1.1} />

        {/* 主编排 */}
        <motion.div {...rise(1.2)} className="panel flex w-[250px] flex-col justify-center gap-3 px-6">
          <div className="flex items-center gap-3">
            <Network size={22} className="text-brand" />
            <p className="t-card-title">主编排 Agent</p>
          </div>
          <div className="hairline" />
          <ul className="t-caption space-y-1.5">
            <li>任务编排 · 澄清唯一出口</li>
            <li>知识检索兜底</li>
            <li className="text-riskc">不直接调用 CampusTools</li>
          </ul>
        </motion.div>

        <Connector delay={1.9} />

        {/* 三域 Agent */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
          {[
            { icon: GraduationCap, name: "课程空间 · Schedule", meta: "7 工具 · schedule_query · common_free_time_query", delay: 2.1 },
            { icon: ShieldAlert, name: "风险规划 · Risk", meta: "4 工具 · risk_check · reschedule_feasibility", delay: 2.45 },
            { icon: BarChart3, name: "校园洞察 · Insight", meta: "3 工具 · overview · teacher_load_query", delay: 2.8 },
          ].map(({ icon: Icon, name, meta, delay }) => (
            <motion.div key={name} {...rise(delay)} className="panel flex items-center gap-4 px-6 py-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-raised">
                <Icon size={19} className="text-stream" />
              </span>
              <div className="min-w-0">
                <p className="t-card-title">{name}</p>
                <p className="t-caption truncate">{meta}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <Connector delay={3.4} />

        {/* CampusTools + 统一结果卡 */}
        <motion.div {...rise(4.2)} className="panel flex w-[330px] flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <Wrench size={20} className="text-brand" />
            <p className="t-card-title">CampusTools · 13 操作</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TOOL_SHORT_NAMES.map((t) => (
              <span key={t} className="rounded border border-line px-2 py-0.5 font-mono text-[11px] text-mute">
                {t}
              </span>
            ))}
          </div>
          <div className="hairline" />
          <div className="flex items-center gap-3">
            <LayoutGrid size={18} className="text-stream" />
            <div>
              <p className="text-[15px] font-medium">统一结果卡 campus-result-unified-v1</p>
              <p className="t-caption">week-board / result-card 双布局 · verified 标记</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* 拓扑注脚 */}
      <motion.div {...rise(6.2, 10)} className="flex flex-wrap items-center gap-3">
        <span className="chip">14 绑定 · SSOT r50.1</span>
        <span className="chip">Main = 0 CampusTools</span>
        <span className="chip">Main → Child → Main</span>
        <span className="chip">唯一共享 academic_context</span>
        <span className="chip">Tool Direct Result OFF</span>
        <span className="chip">
          <span className="inline-block size-1.5 rounded-full bg-[var(--success)]" />
          Verified
        </span>
      </motion.div>
    </div>
  );
}
