import { motion } from "motion/react";
import { BookOpen, Clock3, DoorOpen, MapPin, UserRound, Users } from "lucide-react";
import type { ComponentType } from "react";
import { openingGraphFixture } from "../../fixtures/opening";
import type { GraphNodeType } from "../../fixtures/opening";
import { EASE_OUT } from "../../motion/motionTokens";

export interface GraphBeats {
  nodes: number;
  connections: number;
  focus: number;
  brand: number;
}

type IconCmp = ComponentType<{ size?: number | string; strokeWidth?: number | string; color?: string }>;
const TYPE_META: Record<GraphNodeType, { color: string; label: string; Icon: IconCmp }> = {
  course: { color: "var(--brand)", label: "课程", Icon: BookOpen },
  teacher: { color: "var(--brand-strong)", label: "教师", Icon: UserRound },
  class: { color: "#A8C4B4", label: "班级", Icon: Users },
  room: { color: "var(--brand-secondary)", label: "教室", Icon: DoorOpen },
  time: { color: "#9CC2E2", label: "时间", Icon: Clock3 },
  campus: { color: "var(--brand-secondary)", label: "校区", Icon: MapPin },
};

/** 连线叙事分组：单条关系 pulse → 第二条 → 局部网络 → 收束到时间/校区。
 *  Phase 2.6：不再 20 条线均匀乱出，而是"理解过程"本身成为动画。 */
const EDGE_PHASES: string[][] = [
  ["teacher-1-course-1"],
  ["teacher-1-course-4"],
  [
    "teacher-2-course-2", "teacher-2-course-3",
    "class-1-course-1", "class-1-course-4", "class-2-course-2", "class-2-course-3",
  ],
  [
    "course-1-room-1", "course-2-room-2", "course-3-room-3", "course-4-room-2",
    "course-1-time-1", "course-3-time-2", "course-2-time-2", "course-4-time-1",
    "room-1-campus-1", "room-2-campus-1", "room-3-campus-1", "time-1-campus-1",
  ],
];

const NODE_LABEL_HALO = { paintOrder: "stroke" as const, stroke: "rgba(5,8,13,0.88)", strokeWidth: 5, strokeLinejoin: "round" as const };

/**
 * CampusTemporalGraph —— Opening 的"教学时空场"（Phase 2.6 重做质感）。
 * 节点更大、标签更清晰（17px + 暗色描边光晕）、关系线更亮；
 * 连线按"单条 → 第二条 → 局部网络 → 收束"的叙事顺序显影；
 * brand 节拍整场降至 0.2 opacity（15~25% 区间），让品牌处于绝对视觉中心。
 * 预算：纯 SVG + CSS dash 动画，无 Canvas/WebGL。
 */
export function CampusTemporalGraph({ beats, dimAtBrand = true }: { beats: GraphBeats; dimAtBrand?: boolean }): JSX.Element {
  const { nodes, edges } = openingGraphFixture.payload;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const phaseOf = new Map<string, number>();
  EDGE_PHASES.forEach((group, phase) => group.forEach((k) => phaseOf.set(k, phase)));

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 940 780" className="h-full w-full" role="img" aria-label="校园教学要素关系图：课程、教师、班级、教室、时间与校区逐渐连接成校园时空场">
        <motion.g
          initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          animate={beats.brand <= 0 ? {} : { x: 40, y: -4, scale: 0.94, opacity: dimAtBrand ? 0.2 : 1 }}
          transition={{ delay: beats.brand, duration: 2.0, ease: EASE_OUT }}
          style={{ transformOrigin: "470px 390px" }}
        >
          {/* 关系线：基底 + 时间脉冲覆层（按叙事相位显影） */}
          {edges.map((e, i) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const key = e.from + "-" + e.to;
            const phase = phaseOf.get(key) ?? 3;
            const delay = beats.connections + phase * 0.85 + (i % 4) * 0.09;
            return (
              <g key={key}>
                <motion.line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="rgba(198,216,236,0.6)"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ delay, duration: 0.85, ease: "easeInOut" }}
                />
                <motion.line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="rgba(138,238,201,0.92)"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className="time-pulse"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: delay + 0.45, duration: 0.7 }}
                />
              </g>
            );
          })}

          {/* 焦点脉冲：两个时间枢纽（focus 节拍） */}
          {nodes.filter((n) => n.hub).map((n, i) => (
            <motion.g key={"pulse-" + n.id}>
              <motion.circle
                cx={n.x} cy={n.y} r={34}
                fill="none" stroke="#9CC2E2" strokeWidth={1.6}
                initial={{ opacity: 0, r: 34 }}
                animate={{ opacity: [0, 0.65, 0], r: [34, 62, 84] }}
                transition={{ delay: beats.focus + 0.2 + i * 0.6, duration: 1.8, ease: "easeOut" }}
              />
              <motion.circle
                cx={n.x} cy={n.y} r={18}
                fill="rgba(156,194,226,0.22)"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: [0, 0.9, 0.35], scale: [0, 1.4, 1] }}
                transition={{ delay: beats.focus + 0.2 + i * 0.6, duration: 1.6, ease: "easeOut" }}
              />
            </motion.g>
          ))}

          {/* 节点：暗场脉冲出现（更大更亮） */}
          {nodes.map((n, i) => {
            const meta = TYPE_META[n.type];
            return (
              <motion.g
                key={n.id}
                initial={{ opacity: 0, y: n.y + 14, scale: 0.88 }}
                animate={{ opacity: 1, y: n.y, scale: 1 }}
                transition={{ delay: beats.nodes + i * 0.13, duration: 0.9, ease: EASE_OUT }}
                style={{ transformOrigin: n.x + "px " + n.y + "px" }}
              >
                <motion.circle
                  cx={n.x} cy={n.y} r={46}
                  fill="none" stroke={meta.color}
                  strokeOpacity={0.55} strokeWidth={1.2}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: [0, 0.55, 0], scale: [0.6, 1.6, 2.0] }}
                  transition={{ delay: beats.nodes + i * 0.13, duration: 1.4, ease: "easeOut" }}
                />
                <motion.g animate={{ y: [0, i % 2 ? -5 : 5, 0] }} transition={{ duration: 7 + (i % 5), repeat: Infinity, ease: "easeInOut" }}>
                  <circle cx={n.x} cy={n.y} r={46} fill="var(--surface-elevated)" fillOpacity={0.96} stroke={meta.color} strokeOpacity={0.68} strokeWidth={1.7} />
                  <circle cx={n.x} cy={n.y} r={46} fill="none" stroke={meta.color} strokeOpacity={0.15} strokeWidth={7} />
                  <svg x={n.x - 17} y={n.y - 17} width={34} height={34}>
                    <meta.Icon size={34} strokeWidth={1.8} color={meta.color} />
                  </svg>
                  <text
                    x={n.x} y={n.y + 78} textAnchor="middle" fontSize={21} fontWeight={580}
                    letterSpacing="2" fill="#D6E2EF" {...NODE_LABEL_HALO}
                  >{n.label}</text>
                </motion.g>
              </motion.g>
            );
          })}
        </motion.g>
      </svg>

      {/* 图例 */}
      <div className="absolute bottom-1 left-1 flex flex-wrap items-center gap-x-6 gap-y-2">
        {(Object.keys(TYPE_META) as GraphNodeType[]).map((t) => (
          <span key={t} className="flex items-center gap-2 text-[16px] tracking-[0.08em] text-mute">
            <span className="inline-block size-2 rounded-full" style={{ background: TYPE_META[t].color }} />
            {TYPE_META[t].label}
          </span>
        ))}
      </div>
    </div>
  );
}
