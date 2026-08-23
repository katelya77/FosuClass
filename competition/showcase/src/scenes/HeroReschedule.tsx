import { motion } from 'motion/react';
import { Check, FlaskConical, TriangleAlert } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { ElectricBorder } from '../vendor/react-bits/ElectricBorder';
import { useHeroClock, reached } from '../stores/directorStore';
import { RESCHEDULE_BEATS } from '../director/heroes/rescheduleTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildRescheduleViewModel } from '../data/adapters/rescheduleAdapter';
import { EASE_OUT, SPRING } from '../motion/motionTokens';

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

/** 手术台周板：SOURCE 聚焦 → TARGET 亮槽 → 课程带景深移动 */
function SurgeryBoard({ phase, showGhost }: { phase: Phase; showGhost: boolean }): JSX.Element {
  const COL_W = 100 / 5;
  const ROW_H = 100 / 4;
  // 事实映射：周一 P5-6 → col0/row2；周四 P7-8 → col3/row3
  const src = { left: 0 * COL_W, top: 2 * ROW_H };
  const dst = { left: 3 * COL_W, top: 3 * ROW_H };
  const pos = phase === 'snap' ? dst : src;
  const moving = phase !== 'source';
  return (
    <div className='flex h-full flex-col'>
      {/* Day header：左侧预留时间轴 gutter，保证与下方网格列严格对齐 */}
      <div className='mb-2 flex'>
        <div className='w-12 shrink-0' />
        <div className='grid min-w-0 flex-1 grid-cols-5'>
          {DAYS.map((d) => (
            <span key={d} className={'text-center text-[12.5px] tracking-widest ' + (phase === 'snap' && d === '周四' ? 'font-semibold text-brand-strong' : 'text-faint')}>{d}</span>
          ))}
        </div>
      </div>

      <div className='flex min-h-0 flex-1'>
        {/* 时间轴列：为网格注入“课时”语义，而非空白黑格 */}
        <div className='relative w-12 shrink-0'>
          {PERIOD_ROWS.map((p) => (
            <span
              key={p.label}
              className={
                'absolute right-2.5 flex items-center justify-end text-[10.5px] leading-none tracking-wider ' +
                (phase === 'snap' && p.row === 3 ? 'font-semibold text-brand-strong' : p.row === 2 ? 'text-faint' : 'text-faint/80')
              }
              style={{ top: p.row * ROW_H + '%', height: ROW_H + '%' }}
            >
              {p.label}
            </span>
          ))}
          <div aria-hidden className='absolute bottom-0 right-0 top-0 w-px bg-line' />
        </div>

        <div className='relative ml-2 min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-canvas-deep/50'>
          {/* 虚淡列带：让空网格呈现为“正在被检索的时空间”，而非一片黑 */}
          {DAYS.map((_, i) => (
            <div
              key={'band' + i}
              aria-hidden
              className={'absolute bottom-0 top-0 ' + (i % 2 === 1 ? 'bg-white/[0.018]' : 'bg-transparent')}
              style={{ left: i * COL_W + '%', width: COL_W + '%' }}
            />
          ))}
          {[1, 2, 3].map((i) => (
            <div key={'h' + i} aria-hidden className='absolute left-0 right-0 h-px bg-line' style={{ top: i * ROW_H + '%' }} />
          ))}
          {[1, 2, 3, 4].map((i) => (
            <div key={'v' + i} aria-hidden className='absolute bottom-0 top-0 w-px bg-line' style={{ left: i * COL_W + '%' }} />
          ))}

          {/* 约束扫描：一束自上而下的光带持续扫过全部时槽，示意引擎正在核验 */}
          <motion.div
            aria-hidden
            className='pointer-events-none absolute bottom-0 top-0 w-12'
            animate={{ left: ['-8%', '104%'] }}
            transition={{ duration: 5.6, repeat: Infinity, ease: 'linear' }}
            style={{ background: 'linear-gradient(90deg, transparent, rgba(124,228,189,0.09), transparent)' }}
          />

          {/* 原槽空位：课次移出后留下 faint 低亮边框，表达“已被释放” */}
          {moving && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.55 }}
              transition={{ duration: 0.5 }}
              className='absolute rounded-xl border border-dashed border-line'
              style={{
                left: 'calc(' + src.left + '% + 6px)', top: 'calc(' + src.top + '% + 6px)',
                width: 'calc(' + COL_W + '% - 12px)', height: 'calc(' + ROW_H + '% - 12px)',
              }}
            >
              <span className='absolute left-2 top-1 text-[10px] opacity-70 tracking-widest text-faint'>已移出</span>
            </motion.div>
          )}

          {/* 目标亮槽：周四 P7-8 远处发光 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={showGhost ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.7 }}
            className='absolute rounded-xl border-2 border-dashed'
            style={{
              left: 'calc(' + dst.left + '% + 6px)', top: 'calc(' + dst.top + '% + 6px)',
              width: 'calc(' + COL_W + '% - 12px)', height: 'calc(' + ROW_H + '% - 12px)',
              borderColor: 'color-mix(in srgb, var(--brand-secondary) 60%, transparent)',
              boxShadow: '0 0 28px -6px rgba(111,157,202,0.5)',
            }}
          >
            <span className='absolute inset-0 flex items-center justify-center text-[11.5px] tracking-widest text-brand-strong'>{C.reschedule.targetGhost}</span>
          </motion.div>

          {/* 移动中的课次块：spring + depth */}
          <motion.div
            className='absolute z-10 rounded-xl border-l-2 bg-raised px-2.5 py-2'
            initial={false}
            animate={{
              left: 'calc(' + pos.left + '% + 6px)',
              top: 'calc(' + pos.top + '% + 6px)',
              width: 'calc(' + COL_W + '% - 12px)',
              height: 'calc(' + ROW_H + '% - 12px)',
              y: phase === 'lift' ? -14 : 0,
              scale: phase === 'lift' ? 1.06 : 1,
              boxShadow: phase === 'lift' ? '0 20px 44px rgba(0,0,0,0.55)' : 'var(--shadow-panel)',
              borderColor: phase === 'snap' ? 'color-mix(in srgb, var(--brand) 55%, transparent)' : 'var(--border-strong)',
            }}
            transition={phase === 'lift' ? { ...SPRING.card } : { duration: 0.9, ease: EASE_OUT }}
            style={{ borderLeftColor: 'var(--brand)' }}
          >
            <motion.p className='truncate text-[13px] font-semibold text-ink' animate={moving ? { opacity: 1 } : { opacity: 0.9 }}>{vm.courseName}</motion.p>
            <p className='truncate text-[11.5px] text-mute'>
              {phase === 'snap' ? vm.target.periodText + ' · ' + vm.autoResolve.suggested.name : vm.source.periodText + ' · ' + vm.source.roomName}
            </p>
          </motion.div>
        </div>
      </div>
      <p className='t-caption mt-3 px-1'>{C.reschedule.notice}</p>
    </div>
  );
}

/** 约束引擎：主脉冲向下传播，逐项 PASS / WARNING */
function ConstraintScanner({ revealed }: { revealed: number }): JSX.Element {
  return (
    <div className='panel material-topline relative flex min-h-0 flex-col p-4 overflow-hidden'>
      <p className='t-caption mb-2'>{C.reschedule.verifyTitle}</p>
      {/* 向下扫描主脉冲 */}
      {revealed > 0 && (
        <motion.div aria-hidden className='pointer-events-none absolute left-0 right-0 h-12'
          initial={{ top: 20, opacity: 0 }} animate={{ top: 20 + revealed * 30, opacity: 0.5 }} transition={{ duration: 0.6, ease: EASE_OUT }}
          style={{ background: 'linear-gradient(180deg, transparent, rgba(124,228,189,0.12), transparent)' }} />
      )}
      <ul className='min-h-0 flex-1 divide-y divide-[var(--border)]'>
        {vm.constraints.map((row, i) => {
          const done = i < revealed;
          return (
            <li key={row.key} className='flex w-full items-center justify-between gap-3 py-[8px]'>
              <span className={'min-w-0 flex-1 truncate text-[13.5px] ' + (done ? 'text-ink' : 'text-faint')}>{row.label}</span>
              <span className='flex items-center gap-2'>
                {!done ? (
                  <span className='text-[11px] tracking-widest text-faint'>· · ·</span>
                ) : row.status === 'warn' ? (
                  <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} className='flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold' style={{ borderColor: 'color-mix(in srgb, var(--risk) 55%, transparent)', color: 'var(--risk-strong)', background: 'var(--risk-dim)' }}>
                    <TriangleAlert size={12} /> 提示
                  </motion.span>
                ) : (
                  <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} className='flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold text-ok' style={{ borderColor: 'color-mix(in srgb, var(--success) 55%, transparent)', background: 'var(--success-dim)' }}>
                    <Check size={12} /> PASS
                  </motion.span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className='t-caption mt-2'>提示 ≠ 失败：连续授课负荷将随结论一并呈现</p>
    </div>
  );
}

/** 候选收敛：18 室 → 筛选 → A1-201 自动选定（全片唯一 ElectricBorder 高潮） */
function CandidateResolver({ stage }: { stage: 'idle' | 'funnel' | 'selected' }): JSX.Element {
  const survivors = vm.candidateNames.slice(0, vm.autoResolve.spaceRoomCount);
  return (
    <div className='panel material-topline flex min-h-0 flex-1 flex-col p-4'>
      <div className='mb-2 flex items-center justify-between'>
        <p className='t-caption'>{C.reschedule.candidatesTitle}</p>
        {stage !== 'idle' && (
          <span className='chip text-[11.5px] tabular-nums'>{vm.candidateNames.length} 间可用 → 核验后 {vm.autoResolve.spaceRoomCount} 间</span>
        )}
      </div>
      {stage === 'idle' ? (
        <div className='min-h-0 flex-1' />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className='relative min-h-0 flex-1'>
          {/* 18 个 room token 网格；funnel 时逐个淡出非候选 */}
          <div className='flex flex-wrap content-start gap-1.5'>
            {vm.candidateNames.map((n, i) => {
              const survivor = survivors.includes(n);
              const hide = stage === 'selected' && !survivor;
              return (
                <motion.span
                  key={n}
                  className='rounded-lg border px-2 py-1 font-mono text-[11px] room-token'
                  initial={{ opacity: 1, scale: 1 }}
                  animate={{
                    opacity: (n === vm.autoResolve.suggested.name ? 1 : hide ? 0.14 : 1),
                    scale: n === vm.autoResolve.suggested.name && stage === 'selected' ? 1.06 : 1,
                  }}
                  transition={{ duration: 0.5, delay: stage === 'selected' ? i * 0.04 : 0, ease: EASE_OUT }}
                  style={{ borderColor: n === vm.autoResolve.suggested.name ? 'color-mix(in srgb, var(--brand) 55%, transparent)' : 'var(--border)', color: n === vm.autoResolve.suggested.name ? 'var(--brand-strong)' : 'var(--text-faint)' }}
                >{n}</motion.span>
              );
            })}
          </div>
          {/* 自动选定 A1-201：ElectricBorder 高潮 */}
          {stage === 'selected' && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE_OUT }} className='mt-3 max-w-[330px]'>
              <ElectricBorder active borderRadius={16} chaos={0.15} speed={1.1}>
                <div className='rounded-[13px] bg-surface px-5 py-4'>
                  <p className='t-caption mb-0.5'>自动选定 · rank 1</p>
                  <p className='text-[28px] font-bold tabular-nums' style={{ color: 'var(--brand-strong)' }}>{vm.autoResolve.suggested.name}</p>
                  <p className='t-caption'>{vm.autoResolve.suggested.campusName} · {vm.autoResolve.suggested.capacity} 座阶梯</p>
                </div>
              </ElectricBorder>
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
}

/** HeroReschedule —— SOURCE → MOVE → VERIFY → RESOLVE → DECIDE。
 *  事实：数据结构 周一5-6@A1-201 → 周四7-8节；可行 + 连续4节提示；mutatedData=false。 */
export function HeroReschedule(): JSX.Element {
  const t = useHeroClock('hero-reschedule');
  const sourceOn = reached(t, at('resched.source'));
  const phase: Phase = !reached(t, at('resched.lift')) ? 'source' : reached(t, at('resched.snap')) ? 'snap' : 'lift';
  const constraintsAt = at('resched.constraints');
  const revealed = reached(t, constraintsAt) ? Math.min(vm.constraints.length, Math.floor((t - constraintsAt) * 1.15) + 1) : 0;
  const candStage = reached(t, at('resched.select')) ? 'selected' : reached(t, at('resched.candidates')) ? 'funnel' : 'idle';
  const decided = reached(t, at('resched.decision'));

  return (
    <div className='stage-safe flex flex-col gap-4'>
      <SceneHeader
        kicker={C.reschedule.kicker}
        headline={C.reschedule.headline}
        sub={C.reschedule.sub}
        badge={<Badge tone='stream' icon={<FlaskConical size={14} />}>模拟调课 · What-if</Badge>}
      />

      <div className='grid min-h-0 flex-1 min-w-0 grid-cols-[1.14fr_1fr] gap-6'>
        <div className='panel material-topline min-h-0 min-w-0 flex-1 p-4'>
          {sourceOn ? <SurgeryBoard phase={phase} showGhost={phase !== 'source'} /> : <div className='h-full' />}
        </div>
        <div className='flex min-h-0 min-w-0 flex-col gap-4'>
          <ConstraintScanner revealed={revealed} />
          <CandidateResolver stage={candStage} />
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={decided ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease: EASE_OUT }}
            className='panel flex items-center justify-between gap-4 border-l-2 px-5 py-4'
            style={{ borderLeftColor: 'var(--success)' }}
          >
            <div>
              <p className='text-[17px] font-semibold' style={{ color: 'var(--brand-strong)' }}>{C.reschedule.decisionFeasible}</p>
              <p className='t-caption mt-0.5'>{vm.warningText}</p>
            </div>
            <Badge tone='stream'>未指定教室 · 自动解析</Badge>
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
