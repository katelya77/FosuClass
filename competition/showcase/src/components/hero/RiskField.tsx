import { motion } from "motion/react";
import type { RiskViewModel } from "../../data/adapters/types";
import { campusStyle } from "../../lib/campus";
import { EASE_OUT } from "../../motion/motionTokens";

const DAYS = ["周一", "周二", "周三", "周四", "周五"];
/** Phase 2.6 构图：1720×560（≈3.07 宽高比 ≈ 1728×562 实容器）——满幅无黑边。
 *  上层=周一~周五时间结构 · 中层=跨校区弧线（空间） · 下层=校区节点。
 *  时间差与空间弧线通过锚线连成一个系统，不再像两张分离的图。 */
const W = 1720, H = 620;
const LEFT = 24, COLW = (W - LEFT * 2) / 5;
const TILE_TOP = 56, ROW_H = 94, TILE_H = 80;
const CAMP_Y = 536;
const CAMP_XS = [300, 740, 1180, 1620];
const CAMP_NAMES = ["校区A", "校区B", "校区C", "校区D"];
const LABEL_HALO = { paintOrder: "stroke" as const, stroke: "rgba(255,250,246,0.94)", strokeWidth: 5, strokeLinejoin: "round" as const };

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
  const activeRouteIndex = rushVisibleFrom > 0 ? Math.min(rushVisibleFrom, vm.rushLinks.length) - 1 : -1;
  const activeRoute = activeRouteIndex >= 0 ? vm.rushLinks[activeRouteIndex] : undefined;
  if (activeRoute) {
    activePairs.add(activeRoute.weekday + "@" + activeRoute.fromTime);
    activePairs.add(activeRoute.weekday + "@" + activeRoute.toTime);
  }
  const isActive = (weekday: number, startTime: string) => activePairs.has(weekday + "@" + startTime);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="教师025 教学时间与跨校区空间关系：课程块经锚线落入校区空间，赶场路径同步点亮两门课">
      {/* 五天列背景（Surface 1：弱透明信息面，不再用重框线） */}
      {DAYS.map((d, i) => {
        const x = LEFT + i * COLW;
        return (
          <motion.g key={d} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.1, duration: 0.7 }}>
            <rect x={x + 7} y={TILE_TOP - 12} width={COLW - 14} height={ROW_H * 3 + 16} rx={20} fill="rgba(255,255,255,0.5)" stroke="rgba(171,105,91,0.16)" />
            <text x={x + COLW / 2} y={32} textAnchor="middle" fontSize={24} fontWeight={680} fill={i === 4 ? "var(--brand-strong)" : "#E4EDF7"}>{d}</text>
          </motion.g>
        );
      })}

      {/* 课程块 + 校区锚线（时间结构 → 空间的落点） */}
      {vm.blocks.map((b, i) => {
        const day = b.weekday;
        const arr = byDay.get(day) ?? [];
        const idx = arr.findIndex((x) => x.startTime === b.startTime);
        const x = LEFT + (day - 1) * COLW + 14;
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
            {showCampus && active && (
              <motion.line x1={cx} y1={y + TILE_H} x2={campusXOf(b.campusName)} y2={CAMP_Y}
                stroke={cs.color}
                strokeOpacity={0.82}
                strokeWidth={2.2}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 0.6 }} />
            )}
            {/* 课程块：路径激活 = 同步高亮（描边 + 亮填充 + 微光） */}
            <motion.rect
              x={x} y={y} width={COLW - 28} height={TILE_H} rx={14}
              fill={active ? cs.bright : cs.dim}
              stroke={active ? cs.color : cs.color + "66"}
              strokeWidth={active ? 2.4 : 1.1}
              initial={false}
              animate={{ opacity: dim && !active ? 0.52 : 1, filter: active ? "drop-shadow(0 10px 18px rgba(232,91,69,0.22))" : "drop-shadow(0 0 0px rgba(0,0,0,0))" }}
              transition={{ duration: 0.45, ease: EASE_OUT }}
            />
            <text x={x + 16} y={y + 32} fontSize={22} fontWeight={700} fill="var(--text)" style={{ opacity: dim && !active ? 0.74 : 1 }}>{b.startTime}</text>
            <text x={x + 16} y={y + 62} fontSize={17} fill={active ? "#ECF4FB" : cs.color} style={{ opacity: dim && !active ? 0.8 : 1 }}>{b.campusName} · {b.roomName}</text>
            {active && (
              <motion.rect
                x={x - 4} y={y - 4} width={COLW - 20} height={TILE_H + 8} rx={16}
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
          <line x1={LEFT + 40} y1={CAMP_Y} x2={W - LEFT - 40} y2={CAMP_Y} stroke="rgba(168,190,214,0.26)" strokeDasharray="2 6" />
          {CAMP_NAMES.map((name, i) => {
            const cs = campusStyle(name);
            const hot = Boolean(activeRoute && (activeRoute.fromCampus === name || activeRoute.toCampus === name));
            return (
              <motion.g key={name} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.7 + i * 0.12, duration: 0.7, ease: EASE_OUT }}
                style={{ transformOrigin: CAMP_XS[i] + "px " + CAMP_Y + "px" }}>
                {hot && (
                  <motion.circle cx={CAMP_XS[i]} cy={CAMP_Y} r={23} fill="none" stroke={cs.color} strokeWidth={1.6}
                    initial={{ opacity: 0, r: 23 }} animate={{ opacity: [0, 0.75, 0.2], r: [23, 40, 50] }}
                    transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 0.8 }} />
                )}
                <circle cx={CAMP_XS[i]} cy={CAMP_Y} r={22} fill="var(--surface-elevated)" stroke={cs.color} strokeOpacity={hot ? 1 : 0.66} strokeWidth={hot ? 2.6 : 1.7} />
                <circle cx={CAMP_XS[i]} cy={CAMP_Y} r={6.5} fill={cs.color} />
                <text x={CAMP_XS[i]} y={CAMP_Y + 50} textAnchor="middle" fontSize={21} fontWeight={620} fill={hot ? "var(--text)" : "var(--text-muted)"} {...LABEL_HALO}>{name}</text>
              </motion.g>
            );
          })}
        </motion.g>
      )}

      {/* 跨校区赶场弧：从课程块锚点落到校区节点，再沿空间弧传播时间脉冲 */}
      {vm.rushLinks.map((r, i) => {
        if (i !== activeRouteIndex) return null;
        const fromIdx = CAMP_NAMES.indexOf(r.fromCampus);
        const toIdx = CAMP_NAMES.indexOf(r.toCampus);
        const x1 = CAMP_XS[fromIdx], x2 = CAMP_XS[toIdx];
        const y1 = CAMP_Y, y2 = CAMP_Y;
        const midX = (x1 + x2) / 2;
        const arcY = CAMP_Y - 150;
        const d = `M ${x1} ${y1} Q ${midX} ${arcY} ${x2} ${y2}`;
        return (
          <motion.g key={"rush-" + i} data-qa-risk-route
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: i * 0.5, duration: 0.7 }}>
            <motion.path d={d} fill="none" stroke="rgba(246,205,138,0.28)" strokeWidth={7}
              strokeLinecap="round" style={{ filter: "blur(6px)" }}
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ delay: i * 0.5, duration: 0.9, ease: EASE_OUT }} />
            <motion.path d={d} fill="none" stroke="rgba(246,205,138,0.95)" strokeWidth={3}
              strokeLinecap="round"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ delay: i * 0.5, duration: 0.9, ease: EASE_OUT }} />
            {/* 时间脉冲沿弧传播 */}
            <motion.circle r={5.5} fill="var(--risk-strong)" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.5 }}>
              <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
            </motion.circle>
            {/* 20′ 时间差徽标（弧顶） */}
            <circle cx={midX} cy={arcY} r={26} fill="rgba(48,38,22,0.94)" stroke="rgba(255,215,149,0.78)" strokeWidth={1.6} />
            <text x={midX} y={arcY + 8} textAnchor="middle" fontSize={21} fontWeight={800} fill="var(--risk-strong)">{r.gapMinutes}′</text>
          </motion.g>
        );
      })}

      {/* 总数由已核验汇总给出；画面始终只保留一条可追踪的示例关系。 */}
      {showRoutes && (
        <motion.text x={W / 2} y={H - 8} textAnchor="middle" fontSize={21} fontWeight={660} fill="var(--risk-strong)"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.7 }} {...LABEL_HALO}>
          当前示例：{activeRoute?.fromCampus ?? "校区A"} → {activeRoute?.toCampus ?? "校区B"} · {activeRoute?.gapMinutes ?? 20} 分钟转场
        </motion.text>
      )}
    </svg>
  );
}
