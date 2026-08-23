import { motion } from "motion/react";
import type { RiskViewModel } from "../../data/adapters/types";
import { campusStyle } from "../../lib/campus";
import { EASE_OUT } from "../../motion/motionTokens";

const DAYS = ["周一", "周二", "周三", "周四", "周五"];
const W = 1500, H = 620;
const LEFT = 20, COLW = (W - LEFT * 2) / 5;
const TILE_TOP = 64, ROW_H = 40, TILE_H = 34;
const CAMP_Y = 520;
const CAMP_XS = ["校区A", "校区B", "校区C", "校区D"].map((_, i) => LEFT + COLW * (i + 0.5));
const CAMP_NAMES = ["校区A", "校区B", "校区C", "校区D"];

interface RiskFieldProps {
  vm: RiskViewModel;
  showBlocks: boolean;
  showCampus: boolean;
  rushVisibleFrom: number;
  showRoutes: boolean;
  dim: boolean; // 4 条线路被抽出时，其余降到 20% opacity
}

export function RiskField({ vm, showBlocks, showCampus, rushVisibleFrom, showRoutes, dim }: RiskFieldProps): JSX.Element {
  const byDay = new Map<number, typeof vm.blocks>();
  for (const b of vm.blocks) {
    const arr = byDay.get(b.weekday) ?? [];
    arr.push(b); byDay.set(b.weekday, arr);
  }
  for (const arr of byDay.values()) arr.sort((a, b) => a.startTime.localeCompare(b.startTime));

  // 每门课 → 底端校区锚点纵线
  const tilePos: Record<string, { x: number; y: number }> = {};
  const campusYOf = (name: string) => CAMP_Y + (CAMP_NAMES.indexOf(name) >= 0 ? CAMP_NAMES.indexOf(name) : 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="教师025 教学时间与跨校区空间关系">
      {/* 五天列背景 */}
      {DAYS.map((d, i) => {
        const x = LEFT + i * COLW;
        return (
          <motion.g key={d} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.1, duration: 0.7 }}>
            <rect x={x + 6} y={TILE_TOP - 12} width={COLW - 12} height={ROW_H * 4} rx={16} fill="rgba(15,22,32,0.55)" stroke="rgba(154,170,190,0.16)" />
            <text x={x + COLW / 2} y={34} textAnchor="middle" fontSize={15} fontWeight={600} fill={i === 4 ? "var(--brand-strong)" : "var(--text-muted)"}>{d}</text>
          </motion.g>
        );
      })}

      {/* 课程块 + 校区锚线 */}
      {vm.blocks.map((b, i) => {
        const day = b.weekday;
        const arr = byDay.get(day) ?? [];
        const idx = arr.findIndex((x) => x.startTime === b.startTime);
        const x = LEFT + (day - 1) * COLW + 12;
        const y = TILE_TOP + idx * ROW_H;
        tilePos[b.startTime + b.campusName] = { x: x + (COLW - 24) / 2, y: y + TILE_H / 2 };
        const cs = campusStyle(b.campusName);
        return (
          <motion.g key={i}
            initial={{ opacity: 0, y: y + 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (showBlocks ? 0.5 : 9) + i * 0.08, duration: 0.7, ease: EASE_OUT }}>
            {/* 到校区节点的纵线 */}
            {showCampus && (
              <motion.line x1={tilePos[b.startTime + b.campusName].x} y1={y + TILE_H} x2={tilePos[b.startTime + b.campusName].x} y2={campusYOf(b.campusName)}
                stroke={cs.color} strokeOpacity={dim ? 0.12 : 0.22} strokeWidth={1} strokeDasharray="3 4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 + i * 0.06, duration: 0.7 }} />
            )}
            <rect x={x} y={y} width={COLW - 24} height={TILE_H} rx={10}
              fill={cs.dim} stroke={cs.color + "55"} strokeWidth={1}
              style={{ opacity: dim ? 0.2 : 1 }} />
            <text x={x + 10} y={y + 15} fontSize={13} fontWeight={600} fill="var(--text)">{b.startTime}</text>
            <text x={x + 10} y={y + 29} fontSize={12.5} fill={cs.color}>{b.campusName} · {b.roomName}</text>
          </motion.g>
        );
      })}

      {/* 校区节点行 */}
      {showCampus && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.8 }}>
          <line x1={LEFT} y1={CAMP_Y - 26} x2={W - LEFT} y2={CAMP_Y - 26} stroke="rgba(154,170,190,0.2)" strokeDasharray="2 5" />
          {CAMP_NAMES.map((name, i) => {
            const cs = campusStyle(name);
            return (
              <motion.g key={name} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.7 + i * 0.12, duration: 0.7, ease: EASE_OUT }}>
                <circle cx={CAMP_XS[i]} cy={CAMP_Y} r={15} fill="var(--surface-elevated)" stroke={cs.color} strokeOpacity={0.6} strokeWidth={1.4} />
                <circle cx={CAMP_XS[i]} cy={CAMP_Y} r={4} fill={cs.color} />
                <text x={CAMP_XS[i]} y={CAMP_Y + 40} textAnchor="middle" fontSize={13} fill="var(--text-muted)">{name}</text>
              </motion.g>
            );
          })}
        </motion.g>
      )}

      {/* 跨校区赶场弧：时间脉冲 + 20′ */}
      {vm.rushLinks.map((r, i) => {
        if (i >= rushVisibleFrom) return null;
        const fromIdx = CAMP_NAMES.indexOf(r.fromCampus);
        const toIdx = CAMP_NAMES.indexOf(r.toCampus);
        const x1 = CAMP_XS[fromIdx], x2 = CAMP_XS[toIdx];
        const y1 = CAMP_Y, y2 = CAMP_Y;
        const midX = (x1 + x2) / 2;
        const arcY = CAMP_Y - 78;
        const d = `M ${x1} ${y1} Q ${midX} ${arcY} ${x2} ${y2}`;
        return (
          <motion.g key={"rush-" + i}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: i * 0.5, duration: 0.7 }}>
            <motion.path d={d} fill="none" stroke="rgba(240,193,120,0.9)" strokeWidth={2}
              strokeLinecap="round"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ delay: i * 0.5, duration: 0.9, ease: EASE_OUT }} />
            {/* 时间脉冲沿弧传播 */}
            <motion.circle r={4} fill="var(--risk-strong)" initial={{ opacity: 0 }} animate={{ opacity: [0,1,0] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.5 }}>
              <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
            </motion.circle>
            <circle cx={midX} cy={arcY} r={16} fill="var(--risk-dim)" stroke="rgba(240,193,120,0.5)" />
            <text x={midX} y={arcY + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--risk-strong)">{r.gapMinutes}′</text>
          </motion.g>
        );
      })}

      {/* 4 条线路被抽出标记 */}
      {showRoutes && (
        <motion.text x={W - 20} y={24} textAnchor="end" fontSize={13.5} fill="var(--risk-strong)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.7 }}>
          跨校区赶场 × {vm.totals.rushWarningCount} · 每段 {vm.rushLinks[0]?.gapMinutes ?? 20} 分钟转场
        </motion.text>
      )}
    </svg>
  );
}