import { motion } from 'motion/react';
import { Check, FlaskConical, TriangleAlert } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { useHeroClock, reached } from '../stores/directorStore';
import { RESCHEDULE_BEATS } from '../director/heroes/rescheduleTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildRescheduleViewModel } from '../data/adapters/rescheduleAdapter';
import { EASE_OUT, SPRING } from '../motion/motionTokens';
import { HeroNarrative } from '../components/director/HeroNarrative';

const vm = buildRescheduleViewModel();
const at = (id: string) => RESCHEDULE_BEATS.find((b) => b.id === id)!.at;
const DAYS = ['周一', '周二', '周三', '周四', '周五'];
// 时间轴行（自上而下共 4 行）；source=第5-6节(row2)，target=第7-8节(row3)
const PERIOD_ROWS = [
  { label: '第1-2节', row: 0 },
  { label: '第3-4节', row: 1 },
  { label: '第5-6节', row: 2 },
  { label: '第7-8节', row: 3 },
] as const;

type Phase = 'source' | 'lift' | 'snap';

/** 手术台周板：SOURCE 聚焦 → TARGET 亮槽 → 课程带景深移动。
 *  Phase 2.6：网格材质化（弱列带+亮行线），提起 = 阴影离地 + 1.06 scale；目标槽呼吸发光。 */
function SurgeryBoard({ phase, showGhost }: { phase: Phase; showGhost: boolean }): JSX.Element {
  const COL_W = 100 / 5;
  const ROW_H = 100 / 4;
  // 事实映射：周一 P5-6 → col0/row2；周四 P7-8 → col3/row3
  const src = { left: 0 * COL_W, top: 2 * ROW_H };
  const dst = { left: 3 * COL_W, top: 3 * ROW_H };
  const pos = phase === 'snap' ? dst : src;
  const moving = phase !== 'source';
  return (
    <div className='surgery-board flex h-full flex-col'>
      {/* Day header：左侧预留时间轴 gutter，保证与下方网格列严格对齐 */}
      <div className='mb-2 flex'>
        <div className='w-16 shrink-0' />
        <div className='grid min-w-0 flex-1 grid-cols-5'>
          {DAYS.map((d) => (
            <span key={d} className={'text-center text-[17px] tracking-widest ' + (phase === 'snap' && d === '周四' ? 'font-semibold text-brand-strong' : 'text-mute')}>{d}</span>
          ))}
        </div>
      </div>

      <div className='flex min-h-0 flex-1'>
        {/* 时间轴列：为网格注入"课时"语义 */}
        <div className='relative w-16 shrink-0'>
          {PERIOD_ROWS.map((p) => (
            <span
              key={p.label}
              className={
                'absolute right-2.5 flex items-center justify-end whitespace-nowrap text-[13px] leading-none tracking-wide ' +
                (phase === 'snap' && p.row === 3 ? 'font-semibold text-brand-strong' : p.row === 2 ? 'text-mute' : 'text-faint')
              }
              style={{ top: p.row * ROW_H + '%', height: ROW_H + '%' }}
            >
              {p.label}
            </span>
          ))}
          <div aria-hidden className='absolute bottom-0 right-0 top-0 w-px bg-line' />
        </div>

        <div className='relative ml-2 min-h-0 flex-1 overflow-hidden rounded-2xl border border-[rgba(171,105,91,0.18)] bg-canvas-deep/55'>
          {/* 目标列：snap 后整列微光，让"去哪"一目了然 */}
          <motion.div
            aria-hidden
            className='absolute bottom-0 top-0'
            style={{ left: 3 * COL_W + '%', width: COL_W + '%', background: 'linear-gradient(90deg, transparent, rgba(232,91,69,0.08), transparent)' }}
            initial={{ opacity: 0 }} animate={phase === 'snap' ? { opacity: 1 } : { opacity: 0 }} transition={{ duration: 0.8 }}
          />
          {/* 虚淡列带：空网格呈现为"正在被检索的时空间" */}
          {DAYS.map((_, i) => (
            <div
              key={'band' + i}
              aria-hidden
              className={'absolute bottom-0 top-0 ' + (i % 2 === 1 ? 'bg-white/[0.022]' : 'bg-transparent')}
              style={{ left: i * COL_W + '%', width: COL_W + '%' }}
            />
          ))}
          {[1, 2, 3].map((i) => (
            <div key={'h' + i} aria-hidden className='absolute left-0 right-0 h-px bg-[rgba(171,105,91,0.1)]' style={{ top: i * ROW_H + '%' }} />
          ))}
          {[1, 2, 3, 4].map((i) => (
            <div key={'v' + i} aria-hidden className='absolute bottom-0 top-0 w-px bg-[rgba(171,105,91,0.09)]' style={{ left: i * COL_W + '%' }} />
          ))}
          {/* 目标行：snap 后整行微微点亮（时间结构参与叙事） */}
          <motion.div
            aria-hidden
            className='absolute left-0 right-0'
            style={{ top: 3 * ROW_H + '%', height: ROW_H + '%', background: 'linear-gradient(180deg, rgba(232,91,69,0.07), rgba(232,91,69,0.02))' }}
            initial={{ opacity: 0 }} animate={phase === 'snap' ? { opacity: 1 } : { opacity: 0 }} transition={{ duration: 0.7 }}
          />

          {/* 约束扫描：一束自上而下的光带持续扫过全部时槽 */}
          <motion.div
            aria-hidden
            className='pointer-events-none absolute bottom-0 top-0 w-14'
            animate={{ left: ['-10%', '104%'] }}
            transition={{ duration: 5.6, repeat: Infinity, ease: 'linear' }}
            style={{ background: 'linear-gradient(90deg, transparent, rgba(232,91,69,0.1), transparent)' }}
          />

          {/* 原槽空位：课次移出后留下 faint 低亮边框 */}
          {moving && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ duration: 0.5 }}
              className='absolute rounded-xl border border-dashed border-line'
              style={{
                left: 'calc(' + src.left + '% + 6px)', top: 'calc(' + src.top + '% + 6px)',
                width: 'calc(' + COL_W + '% - 12px)', height: 'calc(' + ROW_H + '% - 12px)',
              }}
            >
              <span className='absolute left-2.5 top-1.5 text-[13px] tracking-widest text-faint'>已移出</span>
            </motion.div>
          )}

          {/* 目标亮槽：周四 P7-8 呼吸发光 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={showGhost ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.7 }}
            className='absolute rounded-xl border-2 border-dashed'
            style={{
              left: 'calc(' + dst.left + '% + 6px)', top: 'calc(' + dst.top + '% + 6px)',
              width: 'calc(' + COL_W + '% - 12px)', height: 'calc(' + ROW_H + '% - 12px)',
              borderColor: 'color-mix(in srgb, var(--brand-strong) 78%, transparent)',
              boxShadow: '0 0 44px -6px rgba(232,91,69,0.34)',
            }}
          >
            <motion.span
              className='absolute inset-0 flex items-center justify-center text-[15px] font-medium tracking-widest text-brand-strong'
              animate={{ opacity: [0.75, 1, 0.75] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              {C.reschedule.targetGhost}
            </motion.span>
          </motion.div>

          {/* 移动轨迹：源槽 → 目标槽 的定向弧（让"空网格"成为一场手术，而非空表格） */}
          {moving && (
            <svg aria-hidden className='pointer-events-none absolute inset-0 z-[4] h-full w-full' preserveAspectRatio='none' viewBox='0 0 100 100'>
              <motion.path
                d={`M ${src.left + COL_W / 2} ${src.top + ROW_H / 2} Q ${(src.left + dst.left) / 2} ${Math.min(src.top, dst.top) - 12} ${dst.left + COL_W / 2} ${dst.top + ROW_H / 2}`}
                fill='none' stroke='rgba(232,91,69,0.54)' strokeWidth={2} strokeLinecap='round'
                strokeDasharray='1.6 1.9' vectorEffect='non-scaling-stroke'
                initial={{ opacity: 0, pathLength: 0 }} animate={{ opacity: 1, pathLength: 1 }}
                transition={{ duration: 0.9, ease: EASE_OUT }}
              />
              <motion.circle r={0.9} fill='var(--brand-strong)'
                animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.5, repeat: Infinity }} style={{ vectorEffect: 'non-scaling-stroke' }}>
                <animateMotion dur='1.5s' repeatCount='indefinite' path={`M ${src.left + COL_W / 2} ${src.top + ROW_H / 2} Q ${(src.left + dst.left) / 2} ${Math.min(src.top, dst.top) - 12} ${dst.left + COL_W / 2} ${dst.top + ROW_H / 2}`} />
              </motion.circle>
            </svg>
          )}

          {/* 移动中的课次块：spring + depth（提起离地 → 落下归位） */}
          <motion.div
            className='surgery-course-card absolute z-10 rounded-xl border-l-2 bg-raised px-3.5 py-3'
            initial={false}
            animate={{
              left: 'calc(' + pos.left + '% + 6px)',
              top: 'calc(' + pos.top + '% + 6px)',
              width: 'calc(' + COL_W + '% - 12px)',
              height: 'calc(' + ROW_H + '% - 12px)',
              y: phase === 'lift' ? -22 : 0,
              scale: phase === 'lift' ? 1.12 : 1,
              boxShadow: phase === 'lift' ? 'var(--shadow-lift)' : 'var(--shadow-panel)',
              borderColor: phase === 'snap' ? 'color-mix(in srgb, var(--brand) 65%, transparent)' : 'var(--border-strong)',
            }}
            transition={phase === 'lift' ? { ...SPRING.card } : { duration: 0.9, ease: EASE_OUT }}
            style={{ borderLeftColor: 'var(--brand)' }}
          >
            <motion.p className='truncate text-[18px] font-semibold text-ink' animate={moving ? { opacity: 1 } : { opacity: 0.92 }}>{vm.courseName}</motion.p>
            <p className='whitespace-nowrap text-[13px] text-mute'>
              {phase === 'snap' ? vm.target.periodText + ' · ' + vm.autoResolve.suggested.name : vm.source.periodText + ' · ' + vm.source.roomName}
            </p>
          </motion.div>
        </div>
      </div>
      <p className='t-caption mt-2.5 px-1'>{C.reschedule.notice}</p>
    </div>
  );
}

/** 六项硬约束以 2×3 紧凑网格呈现；负荷提醒独立于硬约束结果。 */
function ConstraintScanner({ revealed }: { revealed: number }): JSX.Element {
  return (
    <div className='constraint-scanner panel material-topline relative flex flex-col p-4' data-qa-reschedule-constraints>
      <div className='mb-3 flex items-center justify-between'>
        <p className='text-[16px] font-semibold text-ink'>{C.reschedule.verifyTitle}</p>
        <span className='text-[14px] font-semibold tabular-nums text-ok'>{revealed > 0 ? Math.min(revealed, vm.constraints.length) + ' / ' + vm.constraints.length : '准备核验'}</span>
      </div>
      <ul className='grid grid-cols-2 gap-2.5'>
        {vm.constraints.map((row, i) => {
          const done = i < revealed;
          const current = i === revealed;
          return (
            <li key={row.key} className={'constraint-card flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-3 ' + (done ? 'is-pass' : current ? 'is-current' : '')} data-qa-text>
              <span className={'text-[15px] font-semibold ' + (done ? 'text-ink' : current ? 'text-mute' : 'text-faint')}>{row.label}</span>
              {done ? (
                <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className='flex shrink-0 items-center gap-1 text-[13px] font-bold text-ok'>
                  <Check size={14} /> PASS
                </motion.span>
              ) : (
                <motion.span className='shrink-0 text-[12px] tracking-widest text-faint' animate={current ? { opacity: [0.35, 0.9, 0.35] } : { opacity: 1 }} transition={{ duration: 1.4, repeat: current ? Infinity : 0 }}>· · ·</motion.span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** HeroReschedule —— SOURCE → MOVE → VERIFY → RESOLVE → DECIDE。
 *  事实：数据结构 周一5-6@A1-201 → 周四7-8节；可行 + 连续4节提示；mutatedData=false。
 *  Phase 2.6：FEASIBLE + WARNING 必须同时在场；判定横幅升为 Surface 2。 */
export function HeroReschedule(): JSX.Element {
  const t = useHeroClock('hero-reschedule');
  const sourceOn = reached(t, at('resched.source'));
  const phase: Phase = !reached(t, at('resched.lift')) ? 'source' : reached(t, at('resched.snap')) ? 'snap' : 'lift';
  const constraintsAt = at('resched.constraints');
  const revealed = reached(t, constraintsAt) ? Math.min(vm.constraints.length, Math.floor((t - constraintsAt) * 1.15) + 1) : 0;
  const decided = reached(t, at('resched.decision'));
  const warningReady = revealed >= vm.constraints.length;

  return (
    <div className='stage-safe relative flex flex-col gap-3.5 pb-[58px] pt-[66px]'>
      <HeroNarrative
        t={t}
        question="移动到周四7–8节，可行吗？"
        conclusion="可行，不等于没有提醒"
        verifyAt={at('resched.constraints')}
        conclusionAt={26.5}
      />
      <SceneHeader
        size='headline'
        kicker={C.reschedule.kicker}
        headline={C.reschedule.headline}
        sub={C.reschedule.sub}
        badge={<Badge tone='stream' icon={<FlaskConical size={15} />}>模拟调课 · What-if</Badge>}
      />

      <div className='grid min-h-0 flex-1 min-w-0 grid-cols-[1.12fr_0.88fr] gap-6'>
        <motion.div
          className='reschedule-board-plane plane material-topline min-h-0 min-w-0 flex-1 p-4'
          animate={{ opacity: decided ? 0.82 : 1 }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        >
          {sourceOn ? <SurgeryBoard phase={phase} showGhost={phase !== 'source'} /> : <div className='h-full' />}
        </motion.div>
        <div className='reschedule-side flex min-h-0 min-w-0 flex-col gap-3'>
          <ConstraintScanner revealed={revealed} />
          <motion.div
            className='reschedule-warning flex items-center gap-3 rounded-2xl border px-4 py-3'
            initial={false}
            animate={{ opacity: warningReady ? 1 : 0.24 }}
            style={{ borderColor: 'color-mix(in srgb, var(--risk) 44%, transparent)', background: 'var(--risk-dim)' }}
            data-qa-reschedule-warning
          >
            <span className='flex size-9 shrink-0 items-center justify-center rounded-full bg-white/55 text-riskc'><TriangleAlert size={18} /></span>
            <div className='min-w-0'>
              <p className='text-[16px] font-bold text-riskc'>连续 4 节提醒</p>
              <p className='text-[13px] leading-snug text-mute'>调整后教师连续授课负荷需要关注</p>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={decided ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease: EASE_OUT }}
            className='reschedule-decision plane-hero flex min-h-0 flex-1 flex-col items-start justify-center gap-2 px-6 py-4'
            style={{ borderLeft: '3px solid var(--success)' }}
            data-qa-reschedule-decision
          >
            <p className='text-[26px] font-bold leading-tight' style={{ color: 'var(--brand-strong)' }}>{C.reschedule.decisionFeasible}</p>
            <p className='text-[15px] leading-snug text-mute'>满足硬约束，但连续授课负荷需要关注</p>
            <div className='mt-1 flex w-full items-center justify-between gap-3'>
              <span className='text-[17px] font-bold text-ink'>可行 ≠ 没有提醒</span>
              <Badge tone='brand'>6 / 6 PASS</Badge>
            </div>
          </motion.div>
        </div>
      </div>

      <footer className='flex items-center justify-between'>
        <p className='t-caption'>{vm.className} · {vm.teacherName} · 第 1 周</p>
        <VerifiedSourcePill />
      </footer>
    </div>
  );
}
