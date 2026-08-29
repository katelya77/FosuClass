import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import type { RiskViewModel } from '../../data/adapters/types';
import { campusStyle } from '../../lib/campus';
import { EASE_OUT_SOFT } from '../primitives/motion';

const DAY_H = 96;

interface ScheduleRailProps {
  vm: RiskViewModel;
  /** 节拍门控 */
  showBlocks: boolean;
  showCampusColor: boolean;
  rushVisibleFrom: number; // 已显示的赶场链数量
  showGap: boolean;
}

/** 教学时间轨：五天 × 六节网格，课程块 + 跨校区转场链路 */
export function ScheduleRail({ vm, showBlocks, showCampusColor, rushVisibleFrom, showGap }: ScheduleRailProps): JSX.Element {
  const byDay = new Map<number, typeof vm.blocks>();
  for (const b of vm.blocks) {
    const arr = byDay.get(b.weekday) ?? [];
    arr.push(b); byDay.set(b.weekday, arr);
  }
  return (
    <div className='relative flex gap-3'>
      {[1, 2, 3, 4, 5].map((day) => (
        <div key={day} className='relative min-w-0 flex-1'>
          <p className='t-caption mb-2 text-center'>{['周一','周二','周三','周四','周五'][day - 1]}</p>
          <div className='rounded-xl border border-line bg-canvas-deep/60 p-2' style={{ height: DAY_H }}>
            {(byDay.get(day) ?? []).map((b, i) => {
              const cs = campusStyle(b.campusName);
              const colored = showCampusColor;
              return (
                <motion.div
                  key={b.periodStart}
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={showBlocks ? { opacity: 1, y: 0, scale: 1 } : {}}
                  transition={{ delay: i * 0.12, duration: 0.7, ease: EASE_OUT_SOFT }}
                  className='mb-1.5 rounded-lg border px-2.5 py-1.5 last:mb-0'
                  style={{
                    background: colored ? cs.dim : 'var(--surface-elevated)',
                    borderColor: colored ? cs.color + '66' : 'var(--border)',
                    borderLeftWidth: 2,
                    borderLeftColor: colored ? cs.color : 'var(--border-strong)',
                  }}
                >
                  <p className='truncate text-[12.5px] font-medium text-ink'>
                    {b.startTime} {b.className.replace(/202\d级/, '')}
                  </p>
                  <motion.p className='truncate text-[11.5px]'
                    animate={{ color: colored ? cs.color : 'var(--text-faint)' }}
                  >
                    {b.campusName} · {b.roomName}
                  </motion.p>
                </motion.div>
              );
            })}
          </div>

          {/* 跨校区转场链路（相邻课次校区不同） */}
          {vm.rushLinks.filter((r) => r.weekday === day && vm.rushLinks.indexOf(r) < rushVisibleFrom).map((r, i) => (
            <motion.div
              key={r.weekday + '-rush'}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.35, duration: 0.6, ease: EASE_OUT_SOFT }}
              className='mt-2 flex items-center justify-center gap-1.5 rounded-full border px-2 py-1'
              style={{ borderColor: 'color-mix(in srgb, var(--risk) 45%, transparent)', background: 'var(--risk-dim)' }}
            >
              <span className='whitespace-nowrap text-[11px] font-medium text-riskc'>{r.fromCampus}</span>
              <span className='relative inline-flex w-9 items-center'>
                <span className='h-px w-full bg-[var(--risk)]/60' />
                <ArrowRight size={10} className='absolute -right-1 text-riskc' />
              </span>
              <span className='whitespace-nowrap text-[11px] font-medium text-riskc'>{r.toCampus}</span>
              {showGap && (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.45, ease: EASE_OUT_SOFT }}
                  className='ml-1 rounded bg-[var(--risk)] px-1 text-[10px] font-semibold text-[#14100a] tabular-nums'
                >
                  {r.gapMinutes}′
                </motion.span>
              )}
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
}