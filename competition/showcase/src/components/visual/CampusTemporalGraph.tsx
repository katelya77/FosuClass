import { motion } from "motion/react";
import { BookOpen, Clock3, DoorOpen, MapPin, UserRound, Users } from "lucide-react";
import type { ComponentType } from "react";
import { openingGraphFixture } from "../../fixtures/opening";
import type { GraphNodeType } from "../../fixtures/opening";

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

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * CampusTemporalGraph —— 自绘 SVG 关系图（不引重型 graph 库）。
 * 节拍由 Opening 场景传入；元素级平滑交给 Motion，节拍只负责「到点触发」。
 * 视觉纪律：线条低透明度、慢速漂移、无粒子宇宙。
 */
export function CampusTemporalGraph({ beats }: { beats: GraphBeats }): JSX.Element {
  const { nodes, edges } = openingGraphFixture.payload;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 980 700" className="h-full w-full" role="img" aria-label="校园教学要素关系图：课程、教师、班级、教室、时间与校区逐渐连接">
        {/* 全局慢速漂移 */}
        <motion.g
          animate={{ y: [0, -7, 0], x: [0, 4, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* 收束：brand 节拍后整簇向品牌侧轻微聚拢并降调 */}
          <motion.g
            initial={{ x: 0, y: 0, scale: 1 }}
            animate={{ x: 30, y: -4, scale: 0.985 }}
            transition={{ delay: beats.brand + 0.3, duration: 2.2, ease: EASE }}
          >
            {/* 连接线（先画，位于节点之下） */}
            {edges.map((e, i) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              return (
                <motion.line
                  key={`${e.from}-${e.to}`}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="rgba(154,170,190,0.30)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{
                    delay: beats.connections + i * 0.14,
                    duration: 1.15,
                    ease: "easeInOut",
                  }}
                />
              );
            })}

            {/* 焦点脉冲：两个时间枢纽节点（focus 节拍） */}
            {nodes.filter((n) => n.hub).map((n, i) => (
              <motion.circle
                key={`pulse-${n.id}`}
                cx={n.x} cy={n.y} r={26}
                fill="none"
                stroke="#8FB6D9"
                strokeWidth={1.2}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.55, 0], r: [26, 46, 58] }}
                transition={{
                  delay: beats.focus + 0.25 + i * 0.5,
                  duration: 1.6,
                  ease: "easeOut",
                }}
              />
            ))}

            {/* 节点 */}
            {nodes.map((n, i) => {
              const meta = TYPE_META[n.type];
              return (
                <motion.g
                  key={n.id}
                  initial={{ opacity: 0, y: n.y + 12, scale: 0.9 }}
                  animate={{ opacity: 1, y: n.y, scale: 1 }}
                  transition={{ delay: beats.nodes + i * 0.13, duration: 0.8, ease: EASE }}
                  style={{ transformOrigin: `${n.x}px ${n.y}px` }}
                >
                  {/* 节点自身微漂移（相位错开） */}
                  <motion.g
                    animate={{ y: [0, i % 2 ? -4 : 4, 0] }}
                    transition={{ duration: 7 + (i % 5), repeat: Infinity, ease: "easeInOut" }}
                  >
                    <circle
                      cx={n.x} cy={n.y} r={30}
                      fill="var(--surface-elevated)"
                      fillOpacity={0.9}
                      stroke={meta.color}
                      strokeOpacity={0.38}
                      strokeWidth={1.2}
                    />
                    <circle cx={n.x} cy={n.y} r={30} fill="none" stroke={meta.color} strokeOpacity={0.08} strokeWidth={5} />
                    {/* 嵌套 svg 定位图标（lucide 自带 viewBox） */}
                    <svg x={n.x - 11} y={n.y - 11} width={22} height={22}>
                      <meta.Icon size={22} strokeWidth={1.75} color={meta.color} />
                    </svg>
                    <text
                      x={n.x} y={n.y + 52}
                      textAnchor="middle"
                      fontSize={13}
                      letterSpacing="1.5"
                      fill="var(--text-muted)"
                    >
                      {n.label}
                    </text>
                  </motion.g>
                </motion.g>
              );
            })}
          </motion.g>
        </motion.g>
      </svg>

      {/* 图例：色彩之外始终有文字（可访问性） */}
      <div className="absolute bottom-1 left-1 flex flex-wrap items-center gap-x-5 gap-y-2">
        {(Object.keys(TYPE_META) as GraphNodeType[]).map((t) => (
          <span key={t} className="flex items-center gap-2 text-[12.5px] tracking-[0.08em] text-faint">
            <span className="inline-block size-2 rounded-full" style={{ background: TYPE_META[t].color }} />
            {TYPE_META[t].label}
          </span>
        ))}
      </div>
    </div>
  );
}
