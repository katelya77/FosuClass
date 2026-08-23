import { motion } from "motion/react";
import type { RiskViewModel } from "../../data/adapters/types";
import { campusStyle } from "../../lib/campus";
import { EASE_OUT } from "../../motion/motionTokens";

const DAYS = ["周一", "周二", "周三", "周四", "周五"];
/** Phase 2.6 构图：1500×640（≈2.34 宽高比，1920 容器内占宽 ~90%）。
 *  上层=周一~周五时间结构 · 中层=跨校区弧线（空间） · 下层=校区节点。
 *  时间差与空间弧线通过锚线连成一个系统，不再像两张分离的图。 */
const W = 1500, H = 640;
const LEFT = 20, COLW = (W - LEFT * 2) / 5;
const TILE_TOP = 60, ROW_H = 72, TILE_H = 62;
const CAMP_Y = 530;
const CAMP_XS = ["校区A", "校区B", "校区C", "校区D"].map((_, i) => LEFT + COLW * (i + 0.5) + 130);
const CAMP_NAMES = ["校区A", "校区B", "校区C", "校区D"];
const LABEL_HALO = { paintOrder: "stroke" as const, stroke: "rgba(5,8,13,0.85)", strokeWidth: 4, strokeLinejoin: "round" as const };

interface RiskFieldProps {
  vm: RiskViewModel;
  showBlocks: boolean;
  showCampus: boolean;
  rushVisibleFrom: number;
  showRoutes: boolean;
  dim: boolean; // 4 条线路被抽出时，其余课次降调
}

export function RiskField({ vm, showBlocks, showCampus, rushVisibleFrom, showRoutes, dim }: RiskFieldProps): JSX.Element {
  const byDay = new Map<number, typeof vm.blocks>();
  for (const b of vm.blocks) {
    const arr = byDay.get(b.weekday) ?? [];
    arr.push(b); byDay.set(b.weekday, arr);
  }
  for (const arr of byDay.values()) arr.sort((a, b) => a.startTime.localeCompare(b.startTime));

  // 每门课 → 底端校区锚点纵线；rush 涉及的课次集合（路径↔课程块同步高亮）
  const tilePos: Record<string, { x: number; y: number }> = {};
  const campusXOf = (name: string) => CAMP_XS[CAMP_NAMES.indexOf(name)] ?? CAMP_XS[0];
  const activePairs = new Set<string>();
  vm.rushLinks.forEach((r, i) => {
    if (i < rushVisibleFrom) {
      activePairs.add(r.weekday + "@" + r.fromTime);
      activePairs.add(r.weekday + "@" + r.toTime);
    }
  });
  const isActive = (weekday: number, startTime: string) => activePairs.has(weekday + "@" + startTime);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="教师025 教学时间与跨校区空间关系：课程块经锚线落入校区空间，赶场路径同步点亮两门课">
      {/* 五天列背景（Surface 1：弱透明信息面，不再用重框线） */}
      {DAYS.map((d, i) => {
        const x = LEFT + i * COLW;
        return (
          <motion.g key={d} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.1, duration: 0.7 }}>
            <rect x={x + 6} y={TILE_TOP - 10} width={COLW - 12} height={ROW_H * 3 + 12} rx={18} fill="rgba(20,29,41,0.42)" stroke="rgba(168,184,204,0.1)" />
            <text x={x + COLW / 2} y={32} textAnchor="middle" fontSize={19} fontWeight={640} fill={i === 4 ? "var(--brand-strong)" : "#C3D0DE"}>{d}</text>
          </motion.g>
        );
      })}

      {/* 课程块 + 校区锚线（时间结构 → 空间的落点） */}
      {vm.blocks.map((b, i) => {
        const day = b.weekday;
        const arr = byDay.get(day) ?? [];
        const idx = arr.findIndex((x) => x.startTime === b.startTime);
        const x = LEFT + (day - 1) * COLW + 12;
        const y = TILE_TOP + idx * ROW_H;
        const cx = x + (COLW - 24) / 2;
        tilePos[b.startTime + b.campusName] = { x: cx, y: y + TILE_H / 2 };
        const cs = campusStyle(b.campusName);
        const active = isActive(b.weekday, b.startTime);
        const key = b.weekday + "@" + b.startTime;
        return (
          <motion.g key={key + "-" + i}
            initial={{ opacity: 0, y: y + 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (showBlocks ? 0.5 : 9) + i * 0.07, duration: 0.65, ease: EASE_OUT }}>
            {/* 到校区节点的锚线：路径激活时同步点亮 */}
            {showCampus && (
              <motion.line x1={cx} y1={y + TILE_H} x2={campusXOf(b.campusName)} y2={CAMP_Y}
                stroke={cs.color}
                strokeOpacity={active ? 0.85 : dim ? 0.1 : 0.26}
                strokeWidth={active ? 2 : 1.1}
                strokeDasharray={active ? "none" : "3 5"}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: (active ? 0.1 : 1.2 + i * 0.05), duration: 0.6 }} />
            )}
            {/* 课程块：路径激活 = 同步高亮（描边 + 亮填充 + 微光） */}
            <motion.rect
              x={x} y={y} width={COLW - 24} height={TILE_H} rx={12}
              fill={active ? cs.bright : cs.dim}
              stroke={active ? cs.color : cs.color + "55"}
              strokeWidth={active ? 2.2 : 1}
              initial={false}
              animate={{ opacity: dim && !active ? 0.24 : 1, filter: active ? "drop-shadow(0 0 14px rgba(79,214,166,0.35))" : "drop-shadow(0 0 0px rgba(0,0,0,0))" }}
              transition={{ duration: 0.45, ease: EASE_OUT }}
            />
            <text x={x + 12} y={y + 24} fontSize={16.5} fontWeight={650} fill="var(--text)" style={{ opacity: dim && !active ? 0.4 : 1 }}>{b.startTime}</text>
            <text x={x + 12} y={y + 47} fontSize={14} fill={active ? "#DCE7F2" : cs.color} style={{ opacity: dim && !active ? 0.45 : 1 }}>{b.campusName} · {b.roomName}</text>
            {active && (
              <motion.rect
                x={x - 3} y={y - 3} width={COLW - 18} height={TILE_H + 6} rx={14}
                fill="none" stroke={cs.color} strokeOpacity={0.5} strokeWidth={1}
                initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: [0, 0.8, 0.35], scale: 1 }}
                transition={{ duration: 1.4, ease: EASE_OUT }}
                style={{ transformOrigin: cx + "px " + (y + TILE_H / 2) + "px" }}
              />
            )}
          </motion.g>
        );
      })}

      {/* 校区节点行（空间层） */}
      {showCampus && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.8 }}>
          <line x1={LEFT + 40} y1={CAMP_Y} x2={W - LEFT - 40} y2={CAMP_Y} stroke="rgba(168,190,214,0.22)" strokeDasharray="2 6" />
          {CAMP_NAMES.map((name, i) => {
            const cs = campusStyle(name);
            const hot = vm.rushLinks.some((r, ri) => ri < rushVisibleFrom && (r.fromCampus === name || r.toCampus === name));
            return (
              <motion.g key={name} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.7 + i * 0.12, duration: 0.7, ease: EASE_OUT }}
                style={{ transformOrigin: CAMP_XS[i] + "px " + CAMP_Y + "px" }}>
                {hot && (
                  <motion.circle cx={CAMP_XS[i]} cy={CAMP_Y} r={20} fill="none" stroke={cs.color} strokeWidth={1.4}
                    initial={{ opacity: 0, r: 20 }} animate={{ opacity: [0, 0.7, 0.2], r: [20, 34, 42] }}
                    transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 0.8 }} />
                )}
                <circle cx={CAMP_XS[i]} cy={CAMP_Y} r={19} fill="var(--surface-elevated)" stroke={cs.color} strokeOpacity={hot ? 0.95 : 0.6} strokeWidth={hot ? 2.2 : 1.5} />
                <circle cx={CAMP_XS[i]} cy={CAMP_Y} r={5.5} fill={cs.color} />
                <text x={CAMP_XS[i]} y={CAMP_Y + 46} textAnchor="middle" fontSize={17} fontWeight={560} fill={hot ? "var(--text)" : "var(--text-muted)"} {...LABEL_HALO}>{name}</text>
              </motion.g>
            );
          })}
        </motion.g>
      )}

      {/* 跨校区赶场弧：从课程块锚点落到校区节点，再沿空间弧传播时间脉冲 */}
      {vm.rushLinks.map((r, i) => {
        if (i >= rushVisibleFrom) return null;
        const fromIdx = CAMP_NAMES.indexOf(r.fromCampus);
        const toIdx = CAMP_NAMES.indexOf(r.toCampus);
        const x1 = CAMP_XS[fromIdx], x2 = CAMP_XS[toIdx];
        const y1 = CAMP_Y, y2 = CAMP_Y;
        const midX = (x1 + x2) / 2;
        const arcY = CAMP_Y - 108;
        const d = `M ${x1} ${y1} Q ${midX} ${arcY} ${x2} ${y2}`;
        return (
          <motion.g key={"rush-" + i}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: i * 0.5, duration: 0.7 }}>
            <motion.path d={d} fill="none" stroke="rgba(246,205,138,0.95)" strokeWidth={2.4}
              strokeLinecap="round"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ delay: i * 0.5, duration: 0.9, ease: EASE_OUT }} />
            {/* 时间脉冲沿弧传播 */}
            <motion.circle r={4.5} fill="var(--risk-strong)" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.5 }}>
              <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
            </motion.circle>
            {/* 20′ 时间差徽标（弧顶） */}
            <circle cx={midX} cy={arcY} r={19} fill="var(--risk-dim)" stroke="rgba(246,205,138,0.6)" strokeWidth={1.2} />
            <text x={midX} y={arcY + 6} textAnchor="middle" fontSize={16} fontWeight={750} fill="var(--risk-strong)">{r.gapMinutes}′</text>
          </motion.g>
        );
      })}

      {/* 4 条线路被抽出标记（底部居中，不再与列头打架） */}
      {showRoutes && (
        <motion.text x={W / 2} y={H - 12} textAnchor="middle" fontSize={17} fontWeight={600} fill="var(--risk-strong)"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.7 }} {...LABEL_HALO}>
          跨校区赶场 × {vm.totals.rushWarningCount} · 每段 {vm.rushLinks[0]?.gapMinutes ?? 20} 分钟转场
        </motion.text>
      )}
    </svg>
  );
}
