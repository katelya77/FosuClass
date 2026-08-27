import { motion } from "motion/react";
import { BookOpen, Clock3, DoorOpen, MapPin, UserRound, Users } from "lucide-react";
import type { ComponentType } from "react";
import { openingGraphFixture, type GraphEdge, type GraphNodeType } from "../../fixtures/opening";
import { EASE_OUT } from "../../motion/motionTokens";

export interface GraphBeats {
  nodes: number;
  connections: number;
  focus: number;
  brand: number;
}

type IconCmp = ComponentType<{ size?: number | string; strokeWidth?: number | string; color?: string }>;

const TYPE_META: Record<GraphNodeType, { color: string; Icon: IconCmp }> = {
  course: { color: "var(--brand)", Icon: BookOpen },
  teacher: { color: "var(--brand-strong)", Icon: UserRound },
  class: { color: "#BD6D78", Icon: Users },
  room: { color: "var(--brand-secondary)", Icon: DoorOpen },
  time: { color: "#8D78AE", Icon: Clock3 },
  campus: { color: "#7C6EA4", Icon: MapPin },
};

const RELATION_META: Record<GraphEdge["kind"], { label: string; order: number; x: number; y: number }> = {
  teaches: { label: "课程 → 教师", order: 0, x: 310, y: 220 },
  belongs: { label: "课程 → 班级", order: 1, x: 305, y: 485 },
  "held-at": { label: "课程 → 教室", order: 2, x: 630, y: 220 },
  scheduled: { label: "课程 → 时间", order: 3, x: 645, y: 492 },
  located: { label: "教室 → 校区", order: 4, x: 845, y: 238 },
};

const NODE_LABEL_HALO = {
  paintOrder: "stroke" as const,
  stroke: "rgba(255,250,246,0.96)",
  strokeWidth: 7,
  strokeLinejoin: "round" as const,
};

function edgePath(edge: GraphEdge): string {
  switch (edge.kind) {
    case "teaches": return "M 470 350 Q 330 215 180 145";
    case "belongs": return "M 470 350 Q 320 485 175 560";
    case "held-at": return "M 470 350 Q 615 210 748 145";
    case "scheduled": return "M 470 350 Q 625 492 770 555";
    case "located": return "M 748 145 Q 850 205 870 350";
  }
}

/**
 * Opening 的教学时空关系解释图。
 * 只显示六类实体和五条有业务意义的关系；关系按类别逐一建立，
 * 不使用装饰性网线，不允许线路交叉或节点压住画面边缘。
 */
export function CampusTemporalGraph({ beats, local, dimAtBrand = true }: { beats: GraphBeats; local: number; dimAtBrand?: boolean }): JSX.Element {
  const { nodes, edges } = openingGraphFixture.payload;

  return (
    <div className="relative h-full w-full" data-qa-opening-graph>
      <svg
        viewBox="0 0 940 700"
        className="h-full w-full"
        role="img"
        aria-label="课程、教师、班级、教室、时间与校区从分散实体逐渐形成清晰教学时空关系"
      >
        <defs>
          <marker id="opening-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M 0 0 L 9 4.5 L 0 9 z" fill="rgba(190,78,62,0.72)" />
          </marker>
        </defs>

        <motion.g
          initial={{ scale: 1, opacity: 1 }}
          animate={{ scale: dimAtBrand ? 0.94 : 1, opacity: dimAtBrand ? 0.12 : 1 }}
          transition={{ duration: 1.05, ease: EASE_OUT }}
          style={{ transformOrigin: "470px 350px" }}
        >
          {edges.map((edge) => {
            const meta = RELATION_META[edge.kind];
            const delay = meta.order < 4 ? beats.connections + meta.order * 0.72 : beats.focus;
            const pathShown = local >= delay;
            const labelShown = local >= delay + 0.58 && !dimAtBrand;
            return (
              <motion.g key={`${edge.from}-${edge.to}`} data-opening-edge={edge.kind} data-opening-visible={pathShown ? "true" : "false"}>
                <motion.path
                  d={edgePath(edge)}
                  fill="none"
                  stroke="rgba(190,78,62,0.58)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  markerEnd="url(#opening-arrow)"
                  vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: pathShown ? 1 : 0, opacity: pathShown ? 1 : 0 }}
                  transition={{ duration: 0.68, ease: EASE_OUT }}
                />
                <motion.g
                  data-opening-label-visible={labelShown ? "true" : "false"}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: labelShown ? 1 : 0, y: labelShown ? 0 : 5 }}
                  transition={{ duration: 0.38, ease: EASE_OUT }}
                >
                  <rect x={meta.x - 58} y={meta.y - 17} width={116} height={34} rx={17} fill="rgba(255,252,249,0.94)" stroke="rgba(190,78,62,0.18)" />
                  <text x={meta.x} y={meta.y + 5} textAnchor="middle" fontSize={14} fontWeight={650} fill="var(--brand-strong)">{meta.label}</text>
                </motion.g>
              </motion.g>
            );
          })}

          {nodes.map((node, index) => {
            const meta = TYPE_META[node.type];
            const central = node.type === "course";
            const shown = local >= beats.nodes + index * 0.16;
            return (
              <motion.g
                key={node.id}
                initial={{ opacity: 0, scale: 0.86 }}
                animate={{ opacity: shown ? 1 : 0, scale: shown ? 1 : 0.86 }}
                transition={{ duration: 0.62, ease: EASE_OUT }}
                style={{ transformOrigin: `${node.x}px ${node.y}px` }}
                data-opening-node={node.type}
              >
                <circle cx={node.x} cy={node.y} r={central ? 58 : 48} fill="rgba(255,253,250,0.97)" stroke={meta.color} strokeOpacity={central ? 0.92 : 0.72} strokeWidth={central ? 3 : 2} />
                <circle cx={node.x} cy={node.y} r={central ? 48 : 39} fill={meta.color} fillOpacity={central ? 0.12 : 0.08} />
                <svg x={node.x - 19} y={node.y - 19} width={38} height={38}>
                  <meta.Icon size={38} strokeWidth={2} color={meta.color} />
                </svg>
                <text x={node.x} y={node.y + (central ? 92 : 78)} textAnchor="middle" fontSize={central ? 27 : 23} fontWeight={central ? 760 : 650} letterSpacing="1" fill="var(--text)" {...NODE_LABEL_HALO}>
                  {node.label}
                </text>
              </motion.g>
            );
          })}
        </motion.g>
      </svg>

      <motion.p
        className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[15px] font-semibold tracking-[0.16em] text-mute"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: local >= beats.focus + 0.6 && !dimAtBrand ? 1 : 0, y: local >= beats.focus + 0.6 ? 0 : 8 }}
        transition={{ duration: 0.55, ease: EASE_OUT }}
      >
        分散实体 → 教学关系 → 可理解的校园时空
      </motion.p>
    </div>
  );
}
