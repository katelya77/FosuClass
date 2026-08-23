import { motion } from "motion/react";
import { BarChart3, GraduationCap, ShieldAlert, UserRound, Wrench, Network } from "lucide-react";
import { SceneHeader } from "../components/primitives/SceneHeader";
import { Badge } from "../components/primitives/Badge";
import { useDirectorStore } from "../stores/directorStore";
import { getSceneStart } from "../director/timeline";
import { SceneCamera } from "../components/visual/SceneCamera";
import { BlurIn } from "../components/visual/TextFx";
import { EASE_OUT } from "../motion/motionTokens";

const TOOLS = [
  "schedule_query", "schedule_range_query", "classroom_search", "entity_search",
  "academic_context", "common_free_time_query", "group_plan", "risk_check", "day_plan",
  "reschedule_feasibility", "overview", "teacher_load_query", "room_utilization_query",
];

const AGENTS = [
  { id: "schedule", label: "课程空间 · Schedule", meta: "7 工具", color: "var(--brand)", Icon: GraduationCap, y: 120 },
  { id: "risk", label: "风险规划 · Risk", meta: "4 工具", color: "var(--risk)", Icon: ShieldAlert, y: 340 },
  { id: "insight", label: "校园洞察 · Insight", meta: "3 工具", color: "var(--brand-secondary)", Icon: BarChart3, y: 560 },
];

function useArchLocal(): number {
  return useDirectorStore((s) => Math.max(0, s.elapsed - getSceneStart("architecture")));
}

/** 路由拓扑：USER → MAIN → 三域 Agent（之一点亮）→ CampusTools → Result → MAIN */
export function ArchitectureScene(): JSX.Element {
  const t = useArchLocal();
  const showIntent = t > 0.4;
  const showMain = t > 1.1;
  const showAgents = t > 2.0;
  const showTools = t > 4.0;
  const routing = t > 6.0;
  const activeAgent = Math.floor(Math.max(0, (t - 6) / 2.5)) % 3;

  const route = (d: string, delay: number) => (
    <motion.path
      d={d}
      fill="none"
      stroke="rgba(111,157,202,0.4)"
      strokeWidth={1.4}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ delay, duration: 1.1, ease: "easeInOut" }}
    />
  );

  return (
    <div className="stage-safe flex flex-col gap-6">
      <SceneHeader
        kicker="系统架构"
        title="一个主编排 · 三个领域智能体 · 一套工具事实层"
        badge={<Badge tone="brand" icon={<Network size={14} />}>Multi-Agent</Badge>}
      />

      <div className="relative min-h-0 flex-1">
        <SceneCamera shot={{ scale: 1 }} className="h-full">
          <svg viewBox="0 0 1600 720" className="h-full w-full">
            {/* ===== 路由线（先画在节点下） ===== */}
            {showMain && (
              <>
                {showIntent && route("M 270 150 C 320 150 340 150 300 340", 1.3)}
                {showAgents && route("M 560 340 C 640 340 600 200 640 120", 2.4)}
                {showAgents && route("M 560 340 L 640 340", 2.6)}
                {showAgents && route("M 560 340 C 640 340 600 500 640 560", 2.8)}
                {showTools && route("M 1040 120 C 1120 120 1140 200 1200 260", 4.4)}
                {showTools && route("M 1040 340 C 1120 340 1140 320 1200 340", 4.6)}
                {showTools && route("M 1040 560 C 1120 560 1140 480 1200 440", 4.8)}
              </>
            )}

            {/* ===== 用户输入 ===== */}
            {showIntent && (
              <motion.g initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.8, ease: EASE_OUT }}>
                <rect x={40} y={80} width={210} height={140} rx={20} fill="rgba(15,22,32,0.8)" stroke="rgba(154,170,190,0.2)" />
                <g transform="translate(70,112)"><UserRound size={22} color="var(--brand-secondary)" /></g>
                <text x={118} y={124} fontSize={17} fontWeight={620} fill="var(--text)">用户输入</text>
                <text x={118} y={150} fontSize={13.5} fill="var(--text-muted)">自然语言校园任务</text>
              </motion.g>
            )}

            {/* ===== 主编排 ===== */}
            {showMain && (
              <motion.g initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.9, ease: EASE_OUT }}>
                <rect x={320} y={230} width={250} height={220} rx={24} fill="rgba(15,22,32,0.85)" stroke="rgba(69,201,154,0.4)" strokeWidth={1.4} />
                <g transform="translate(350,258)"><Network size={24} color="var(--brand)" /></g>
                <text x={386} y={276} fontSize={18} fontWeight={650} fill="var(--text)">主编排 Agent</text>
                <text x={350} y={316} fontSize={13.5} fill="var(--text-muted)">任务编排 · 澄清唯一出口</text>
                <text x={350} y={340} fontSize={13.5} fill="var(--text-muted)">知识检索兜底</text>
                <text x={350} y={364} fontSize={13.5} fill="var(--risk)">Main 不直接调用 CampusTools</text>
                <rect x={350} y={396} width={190} height={30} rx={10} fill="var(--brand-dim)" />
                <text x={374} y={416} fontSize={12.5} fill="var(--brand-strong)">Main → Child → Main</text>
              </motion.g>
            )}

            {/* ===== 三域 Agent ===== */}
            {AGENTS.map((a, ai) => (
              showAgents && (
                <motion.g key={a.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.2 + ai * 0.25, duration: 0.8, ease: EASE_OUT }}>
                  <rect x={680} y={a.y} width={350} height={80} rx={20}
                    fill={routing && activeAgent === ai ? "rgba(69,201,154,0.12)" : "rgba(15,22,32,0.8)"}
                    stroke={routing && activeAgent === ai ? "rgba(69,201,154,0.5)" : "rgba(154,170,190,0.2)"} strokeWidth={1.2} />
                  <circle cx={712} cy={a.y + 40} r={18} fill="var(--surface-elevated)" stroke={a.color} strokeOpacity={0.5} />
                  <g transform={"translate(" + (712 - 9) + "," + (a.y + 31) + ")"}><a.Icon size={18} color={a.color} /></g>
                  <text x={742} y={a.y + 34} fontSize={16} fontWeight={620} fill="var(--text)">{a.label}</text>
                  <text x={742} y={a.y + 58} fontSize={13} fill="var(--text-muted)">{a.meta} · {a.id}_query</text>
                  {routing && activeAgent === ai && (
                    <motion.circle cx={690} cy={a.y + 40} r={5} fill="var(--brand-strong)" initial={{ opacity: 0 }} animate={{ opacity: [0,1,0] }} transition={{ duration: 1.1, repeat: Infinity }} />
                  )}
                </motion.g>
              )
            ))}

            {/* ===== CampusTools 事实层 ===== */}
            {showTools && (
              <motion.g initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 4.2, duration: 0.9, ease: EASE_OUT }}>
                <rect x={1210} y={150} width={360} height={430} rx={24} fill="rgba(15,22,32,0.85)" stroke="rgba(154,170,190,0.25)" />
                <g transform="translate(1240,180)"><Wrench size={20} color="var(--brand)" /></g>
                <text x={1274} y={196} fontSize={17} fontWeight={650} fill="var(--text)">CampusTools · 13 操作</text>
                <text x={1240} y={228} fontSize={12.5} fill="var(--text-muted)">确定性事实源 · 模型不得改写</text>
                <g>
                  {TOOLS.slice(0, 7).map((tl, i) => (
                    <g key={tl} transform={"translate(" + (1240 + (i % 3) * 116) + "," + (248 + Math.floor(i / 3) * 34) + ")"}>
                      <rect width={104} height={26} rx={7} fill="var(--surface-elevated)" stroke="rgba(154,170,190,0.18)" />
                      <text x={52} y={18} textAnchor="middle" fontSize={12} fill="var(--text-muted)" style={{ fontFamily: "var(--font-mono)" }}>{tl}</text>
                    </g>
                  ))}
                </g>
                <line x1={1240} y1={378} x2={1540} y2={378} stroke="rgba(154,170,190,0.2)" />
                <text x={1240} y={412} fontSize={15} fontWeight={620} fill="var(--text)">统一结果卡 campus-result-unified-v1</text>
                <text x={1240} y={438} fontSize={12.5} fill="var(--text-muted)">week-board / result-card 双布局</text>
                <text x={1240} y={462} fontSize={12.5} fill="var(--success)">✓ verified 标记贯穿输出</text>
              </motion.g>
            )}

            {/* ===== 结果回执返回 MAIN（底部） ===== */}
            {showTools && (
              <motion.path
                d="M 1390 580 C 1390 650 460 700 380 460"
                fill="none" stroke="rgba(90,196,147,0.35)" strokeWidth={1.4} strokeDasharray="4 6"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 5.2, duration: 1.4, ease: "easeInOut" }}
              />
            )}

            {/* ===== routing 激活：packet 沿主人路径传播 ===== */}
            {routing && (
              <motion.circle r={4.5} fill="var(--brand-strong)" initial={{ opacity: 0 }} animate={{ opacity: [0,1,1,0] }} transition={{ duration: 2.2, repeat: Infinity }}>
                <animateMotion dur="2.2s" repeatCount="indefinite" path="M 270 150 C 320 150 340 150 300 340" />
              </motion.circle>
            )}
          </svg>
        </SceneCamera>
      </div>

      <BlurIn delay={6.4} className="flex flex-wrap items-center gap-3">
        <span className="chip">14 绑定 · SSOT r50.1</span>
        <span className="chip">Main = 0 CampusTools</span>
        <span className="chip">Main → Child → Main</span>
        <span className="chip">唯一共享 academic_context</span>
        <span className="chip">Tool Direct Result OFF</span>
        <span className="chip"><span className="inline-block size-1.5 rounded-full bg-[var(--success)]" />Verified</span>
      </BlurIn>
    </div>
  );
}