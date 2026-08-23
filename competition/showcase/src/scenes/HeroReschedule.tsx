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
    <div className='flex h-full flex-col'>
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
                (phase === 'snap' && p.row === 3 ? 'font-semibold text-brand-strong' : p.row === 2 ? 'text-muted' : 'text-faint')
              }
              style={{ top: p.row * ROW_H + '%', height: ROW_H + '%' }}
            >
              {p.label}
            </span>
          ))}
          <div aria-hidden className='absolute bottom-0 right-0 top-0 w-px bg-line' />
        </div>

        <div className='relative ml-2 min-h-0 flex-1 overflow-hidden rounded-2xl border border-[rgba(190,206,226,0.22)] bg-canvas-deep/55'>
          {/* 目标列：snap 后整列微光，让"去哪"一目了然 */}
          <motion.div
            aria-hidden
            className='absolute bottom-0 top-0'
            style={{ left: 3 * COL_W + '%', width: COL_W + '%', background: 'linear-gradient(90deg, transparent, rgba(86,224,176,0.08), transparent)' }}
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
            <div key={'h' + i} aria-hidden className='absolute left-0 right-0 h-px bg-[rgba(168,184,204,0.12)]' style={{ top: i * ROW_H + '%' }} />
          ))}
          {[1, 2, 3, 4].map((i) => (
            <div key={'v' + i} aria-hidden className='absolute bottom-0 top-0 w-px bg-[rgba(168,184,204,0.1)]' style={{ left: i * COL_W + '%' }} />
          ))}
          {/* 目标行：snap 后整行微微点亮（时间结构参与叙事） */}
          <motion.div
            aria-hidden
            className='absolute left-0 right-0'
            style={{ top: 3 * ROW_H + '%', height: ROW_H + '%', background: 'linear-gradient(180deg, rgba(79,214,166,0.07), rgba(79,214,166,0.02))' }}
            initial={{ opacity: 0 }} animate={phase === 'snap' ? { opacity: 1 } : { opacity: 0 }} transition={{ duration: 0.7 }}
          />

          {/* 约束扫描：一束自上而下的光带持续扫过全部时槽 */}
          <motion.div
            aria-hidden
            className='pointer-events-none absolute bottom-0 top-0 w-14'
            animate={{ left: ['-10%', '104%'] }}
            transition={{ duration: 5.6, repeat: Infinity, ease: 'linear' }}
            style={{ background: 'linear-gradient(90deg, transparent, rgba(138,238,201,0.11), transparent)' }}
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
              boxShadow: '0 0 44px -6px rgba(147,244,209,0.62)',
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
                fill='none' stroke='rgba(138,238,201,0.6)' strokeWidth={2} strokeLinecap='round'
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
            className='absolute z-10 rounded-xl border-l-2 bg-raised px-3.5 py-3'
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
            <p className='truncate text-[15px] text-muted'>
              {phase === 'snap' ? vm.target.periodText + ' · ' + vm.autoResolve.suggested.name : vm.source.periodText + ' · ' + vm.source.roomName}
            </p>
          </motion.div>
        </div>
      </div>
      <p className='t-caption mt-2.5 px-1'>{C.reschedule.notice}</p>
    </div>
  );
}

/** 约束引擎：主脉冲向下传播，逐项 PASS / WARNING（引擎"活着"的感觉） */
function ConstraintScanner({ revealed }: { revealed: number }): JSX.Element {
  return (
    <div className='panel material-topline relative flex min-h-0 flex-col overflow-hidden p-4'>
      <div className='mb-1.5 flex items-center justify-between'>
        <p className='t-caption'>{C.reschedule.verifyTitle}</p>
        <span className='text-[14px] tabular-nums text-muted'>{revealed > 0 ? revealed + ' / ' + vm.constraints.length : ''}</span>
      </div>
      {/* 向下扫描主脉冲 */}
      {revealed > 0 && (
        <motion.div aria-hidden className='pointer-events-none absolute left-0 right-0 h-12'
          initial={{ top: 20, opacity: 0 }} animate={{ top: 26 + revealed * 34, opacity: 0.55 }} transition={{ duration: 0.6, ease: EASE_OUT }}
          style={{ background: 'linear-gradient(180deg, transparent, rgba(138,238,201,0.14), transparent)' }} />
      )}
      <ul className='relative min-h-0 flex-1 divide-y divide-[rgba(168,184,204,0.1)] pl-8'>
        <span aria-hidden className='absolute bottom-3 left-[9px] top-3 w-px bg-[rgba(168,184,204,0.16)]' />
        {vm.constraints.map((row, i) => {
          const done = i < revealed;
          const current = i === revealed;
          return (
            <li key={row.key} className='relative flex w-full items-center justify-between gap-3 py-[9px]'>
              <span aria-hidden className='absolute -left-8 top-1/2 flex size-[15px] -translate-y-1/2 items-center justify-center rounded-full border text-[9.5px] tabular-nums'
                style={done
                  ? { borderColor: 'color-mix(in srgb, var(--success) 60%, transparent)', color: 'var(--success)', background: 'var(--success-dim)' }
                  : { borderColor: 'rgba(168,184,204,0.3)', color: 'var(--text-faint)', background: 'var(--bg-deep)' }}>
                {i + 1}
              </span>
              <span className={'min-w-0 flex-1 truncate text-[16px] ' + (done ? 'text-ink' : current ? 'text-muted' : 'text-faint')}>{row.label}</span>
              <span className='flex items-center gap-2'>
                {!done ? (
                  <motion.span
                    className='text-[12px] tracking-widest text-faint'
                    animate={current ? { opacity: [0.35, 0.9, 0.35] } : { opacity: 1 }}
                    transition={{ duration: 1.4, repeat: current ? Infinity : 0, ease: 'easeInOut' }}
                  >· · ·</motion.span>
                ) : row.status === 'warn' ? (
                  <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} className='flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[15px] font-semibold' style={{ borderColor: 'color-mix(in srgb, var(--risk) 60%, transparent)', color: 'var(--risk-strong)', background: 'var(--risk-dim)' }}>
                    <TriangleAlert size={13} /> 提示
                  </motion.span>
                ) : (
                  <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} className='flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[15px] font-semibold text-ok' style={{ borderColor: 'color-mix(in srgb, var(--success) 60%, transparent)', background: 'var(--success-dim)' }}>
                    <Check size={13} /> PASS
                  </motion.span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className='t-caption mt-1.5'>提示 ≠ 失败：连续授课负荷将随结论一并呈现</p>
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
        <span className='chip text-[12.5px] tabular-nums'>{vm.candidateNames.length} 间可用 → 核验后 {vm.autoResolve.spaceRoomCount} 间</span>
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className='relative min-h-0 flex-1'>
        {/* 18 个 room token 网格：idle 即以低亮度在场（面板永不空置）；funnel 逐个收敛 */}
        <div className='flex flex-wrap content-start gap-1.5'>
          {vm.candidateNames.map((n, i) => {
            const survivor = survivors.includes(n);
            const isPick = n === vm.autoResolve.suggested.name;
            const idleDim = stage === 'idle';
            const dimmed = stage !== 'idle' && !survivor;
            return (
              <motion.span
                key={n}
                className='room-token rounded-lg border px-2 py-1 font-mono text-[12.5px]'
                initial={{ opacity: 1, scale: 1 }}
                animate={{
                  opacity: isPick ? 1 : dimmed ? 0.26 : idleDim ? 0.42 : 0.96,
                  scale: isPick && stage === 'selected' ? 1.1 : 1,
                  borderColor: isPick && stage !== 'idle' ? 'color-mix(in srgb, var(--brand) 65%, transparent)' : 'rgba(168,184,204,0.2)',
                  color: isPick && stage !== 'idle' ? 'var(--brand-strong)' : idleDim ? 'var(--text-faint)' : 'var(--text-muted)',
                }}
                transition={{ duration: 0.5, delay: stage === 'selected' ? i * 0.04 : 0, ease: EASE_OUT }}
              >{n}</motion.span>
            );
          })}
        </div>
        {/* 自动选定 A1-201：ElectricBorder 高潮（整幅主角，不再挤压成小卡） */}
        {stage === 'selected' && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE_OUT }} className='mt-3'>
            <ElectricBorder active borderRadius={16} chaos={0.15} speed={1.1}>
              <div className='flex items-center justify-between gap-5 rounded-[13px] bg-surface px-6 py-4'>
                <div>
                  <p className='t-caption mb-0.5'>自动选定 · rank 1</p>
                  <p className='text-[36px] font-bold leading-none tabular-nums' style={{ color: 'var(--brand-strong)' }}>{vm.autoResolve.suggested.name}</p>
                </div>
                <div className='text-right'>
                  <p className='t-caption'>{vm.autoResolve.suggested.campusName}</p>
                  <p className='t-caption'>{vm.autoResolve.suggested.capacity} 座 · 满足容量</p>
                </div>
              </div>
            </ElectricBorder>
          </motion.div>
        )}
      </motion.div>
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
  const candStage = reached(t, at('resched.select')) ? 'selected' : reached(t, at('resched.candidates')) ? 'funnel' : 'idle';
  const decided = reached(t, at('resched.decision'));

  return (
    <div className='stage-safe flex flex-col gap-3.5'>
      <SceneHeader
        size='headline'
        kicker={C.reschedule.kicker}
        headline={C.reschedule.headline}
        sub={C.reschedule.sub}
        badge={<Badge tone='stream' icon={<FlaskConical size={15} />}>模拟调课 · What-if</Badge>}
      />

      <div className='grid min-h-0 flex-1 min-w-0 grid-cols-[1.14fr_1fr] gap-6'>
        <motion.div
          className='plane material-topline min-h-0 min-w-0 flex-1 p-4'
          animate={{ opacity: decided ? 0.82 : 1 }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        >
          {sourceOn ? <SurgeryBoard phase={phase} showGhost={phase !== 'source'} /> : <div className='h-full' />}
        </motion.div>
        <div className='flex min-h-0 min-w-0 flex-col gap-4'>
          <ConstraintScanner revealed={revealed} />
          <CandidateResolver stage={candStage} />
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={decided ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease: EASE_OUT }}
            className='plane-hero flex items-center justify-between gap-4 px-6 py-4'
            style={{ borderLeft: '3px solid var(--success)' }}
          >
            <div>
              <div className='flex items-center gap-2.5'>
                <p className='text-[23px] font-bold' style={{ color: 'var(--brand-strong)' }}>{C.reschedule.decisionFeasible}</p>
                <span className='flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold' style={{ borderColor: 'color-mix(in srgb, var(--risk) 60%, transparent)', color: 'var(--risk-strong)', background: 'var(--risk-dim)' }}>
                  <TriangleAlert size={12.5} /> 连续 4 节提示
                </span>
              </div>
              <p className='t-caption mt-1'>{vm.warningText}</p>
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
