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
  class: { color: "#9DB8AC", label: "班级", Icon: Users },
  room: { color: "var(--brand-secondary)", label: "教室", Icon: DoorOpen },
  time: { color: "#8FB6D9", label: "时间", Icon: Clock3 },
  campus: { color: "var(--brand-secondary)", label: "校区", Icon: MapPin },
};

/**
 * CampusTemporalGraph —— Opening 的"教学时空场"（Phase 2.5 重做）。
 * 叙事：暗场 → 少量要素脉冲出现 → 时间脉冲沿关系线传播（信息开始被理解）→
 *      散乱关系收束成稳定时空场 → camera pull back 让品牌显影。
 * 预算：纯 SVG/Canvas 无、无 WebGL；时间脉冲用 CSS dash 动画。
 */
export function CampusTemporalGraph({ beats }: { beats: GraphBeats }): JSX.Element {
  const { nodes, edges } = openingGraphFixture.payload;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 980 700" className="h-full w-full" role="img" aria-label="校园教学要素关系图：课程、教师、班级、教室、时间与校区逐渐连接成校园时空场">
        <motion.g
          initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          animate={beats.brand <= 0 ? {} : { x: 46, y: -6, scale: 0.92, opacity: 0.86 }}
          transition={{ delay: beats.brand, duration: 2.2, ease: EASE_OUT }}
        >
          {/* 关系线：基底 + 时间脉冲覆层 */}
          {edges.map((e, i) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
            return (
              <g key={e.from + "-" + e.to}>
                {/* 基底细线：连接节拍后出现 */}
                <motion.line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="rgba(154,170,190,0.26)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ delay: beats.connections + i * 0.1, duration: 1.0, ease: "easeInOut" }}
                />
                {/* 时间脉冲：沿路径传播（信息正在被理解） */}
                <motion.line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="rgba(124,228,189,0.6)"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className="time-pulse"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: beats.connections + i * 0.12 + 0.5, duration: 0.8 }}
                />
              </g>
            );
          })}

          {/* 焦点脉冲：两个时间枢纽（focus 节拍） */}
          {nodes.filter((n) => n.hub).map((n, i) => (
            <motion.g key={"pulse-" + n.id}>
              <motion.circle
                cx={n.x} cy={n.y} r={24}
                fill="none" stroke="#8FB6D9" strokeWidth={1.2}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.5, 0], r: [24, 46, 62] }}
                transition={{ delay: beats.focus + 0.2 + i * 0.6, duration: 1.8, ease: "easeOut" }}
              />
              <motion.circle
                cx={n.x} cy={n.y} r={14}
                fill="rgba(143,182,217,0.16)"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: [0, 0.8, 0.3], scale: [0, 1.4, 1] }}
                transition={{ delay: beats.focus + 0.2 + i * 0.6, duration: 1.6, ease: "easeOut" }}
              />
            </motion.g>
          ))}

          {/* 节点：暗场脉冲出现 */}
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
                {/* 出现 ripple */}
                <motion.circle
                  cx={n.x} cy={n.y} r={30}
                  fill="none" stroke={meta.color}
                  strokeOpacity={0.5} strokeWidth={1}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: [0, 0.5, 0], scale: [0.6, 1.7, 2.1] }}
                  transition={{ delay: beats.nodes + i * 0.13, duration: 1.4, ease: "easeOut" }}
                />
                <motion.g animate={{ y: [0, i % 2 ? -5 : 5, 0] }} transition={{ duration: 7 + (i % 5), repeat: Infinity, ease: "easeInOut" }}>
                  <circle cx={n.x} cy={n.y} r={29} fill="var(--surface-elevated)" fillOpacity={0.92} stroke={meta.color} strokeOpacity={0.4} strokeWidth={1.2} />
                  <circle cx={n.x} cy={n.y} r={29} fill="none" stroke={meta.color} strokeOpacity={0.1} strokeWidth={5} />
                  <svg x={n.x - 11} y={n.y - 11} width={22} height={22}>
                    <meta.Icon size={22} strokeWidth={1.75} color={meta.color} />
                  </svg>
                  <text x={n.x} y={n.y + 52} textAnchor="middle" fontSize={13} letterSpacing="1.5" fill="var(--text-muted)">{n.label}</text>
                </motion.g>
              </motion.g>
            );
          })}
        </motion.g>
      </svg>

      {/* 图例 */}
      <div className="absolute bottom-1 left-1 flex flex-wrap items-center gap-x-5 gap-y-2">
        {(Object.keys(TYPE_META) as GraphNodeType[]).map((t) => (
          <span key={t} className="flex items-center gap-2 text-[13px] tracking-[0.08em] text-faint">
            <span className="inline-block size-2 rounded-full" style={{ background: TYPE_META[t].color }} />
            {TYPE_META[t].label}
          </span>
        ))}
      </div>
    </div>
  );
}
