import { motion } from 'motion/react';
import { Check, FlaskConical, TriangleAlert } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { EASE_OUT_SOFT } from '../components/primitives/motion';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { ElectricBorder } from '../vendor/react-bits/ElectricBorder';
import { useHeroClock, reached } from '../stores/directorStore';
import { RESCHEDULE_BEATS } from '../director/heroes/rescheduleTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildRescheduleViewModel } from '../data/adapters/rescheduleAdapter';

const vm = buildRescheduleViewModel();
const at = (id: string) => RESCHEDULE_BEATS.find((b) => b.id === id)!.at;
const DAYS = ['周一', '周二', '周三', '周四', '周五'];

type Phase = 'source' | 'lift' | 'snap';

/** 周板：第 5–8 节 × 五天；课程块以绝对坐标做 Temporal Surgery */
function SurgeryBoard({ phase, showGhost }: { phase: Phase; showGhost: boolean }): JSX.Element {
  const COL_W = 100 / 5;
  const ROW_H = 100 / 4;
  const src = { left: 0 * COL_W, top: 0 * ROW_H }; // 周一 P5
  const dst = { left: 3 * COL_W, top: 2 * ROW_H }; // 周四 P7
  const pos = phase === 'snap' ? dst : src;
  return (
    <div className='flex h-full flex-col'>
      <div className='mb-1.5 grid grid-cols-5 gap-1.5'>
        {DAYS.map((d) => (
          <span key={d} className={'text-center text-[12px] tracking-widest ' + (phase === 'snap' && d === '周四' ? 'font-medium text-stream' : 'text-faint')}>{d}</span>
        ))}
      </div>
      <div className='relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-canvas-deep/60'>
        {/* 网格 */}
        {[1, 2, 3].map((i) => (
          <div key={'h' + i} aria-hidden className='absolute left-0 right-0 h-px bg-line' style={{ top: i * ROW_H + '%' }} />
        ))}
        {[1, 2, 3, 4].map((i) => (
          <div key={'v' + i} aria-hidden className='absolute bottom-0 top-0 w-px bg-line' style={{ left: i * COL_W + '%' }} />
        ))}

        {/* 目标幽灵槽：周四 P7-8 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={showGhost ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6 }}
          className='absolute rounded-lg border-2 border-dashed'
          style={{
            left: 'calc(' + dst.left + '% + 5px)', top: 'calc(' + dst.top + '% + 5px)',
            width: 'calc(' + COL_W + '% - 10px)', height: 'calc(' + ROW_H + '% - 10px)',
            borderColor: 'color-mix(in srgb, var(--brand-secondary) 60%, transparent)',
          }}
        >
          <span className='absolute inset-0 flex items-center justify-center text-[11px] tracking-widest text-stream'>{C.reschedule.targetGhost}</span>
        </motion.div>

        {/* 移动中的课次块 */}
        <motion.div
          className='absolute z-10 rounded-lg border-l-2 bg-raised px-2.5 py-1.5'
          initial={false}
          animate={{
            left: 'calc(' + pos.left + '% + 5px)',
            top: 'calc(' + pos.top + '% + 5px)',
            width: 'calc(' + COL_W + '% - 10px)',
            height: 'calc(' + ROW_H + '% - 10px)',
            y: phase === 'lift' ? -10 : 0,
            scale: phase === 'lift' ? 1.05 : 1,
            boxShadow: phase === 'lift' ? '0 14px 34px rgba(0,0,0,0.45)' : 'var(--shadow-panel)',
            borderColor: phase === 'snap' ? 'color-mix(in srgb, var(--brand) 55%, transparent)' : 'var(--border-strong)',
          }}
          transition={{ duration: 0.85, ease: EASE_OUT_SOFT }}
          style={{ borderLeftColor: 'var(--brand)' }}
        >
          <p className='truncate text-[12.5px] font-medium text-ink'>{vm.courseName}</p>
          <p className='truncate text-[11px] text-mute'>{vm.source.periodText} · {vm.source.roomName}</p>
        </motion.div>
      </div>
    </div>
  );
}

/** 约束矩阵：逐项核验动画，WARNING ≠ FAIL */
function VerifyMatrix({ revealed }: { revealed: number }): JSX.Element {
  return (
    <div className='panel flex min-h-0 flex-col p-4'>
      <p className='t-caption mb-2'>{C.reschedule.verifyTitle}</p>
      <ul className='min-h-0 flex-1 divide-y divide-[var(--border)]'>
        {vm.constraints.map((row, i) => {
          const shown = i < revealed;
          const done = shown;
          return (
            <li key={row.key} className='flex items-center justify-between gap-3 py-[7px]'>
              <span className={'text-[13.5px] ' + (done ? 'text-ink' : 'text-faint')}>{row.label}</span>
              <span className='flex items-center gap-2'>
                {!done ? (
                  <span className='text-[11px] tracking-widest text-faint'>· · ·</span>
                ) : row.status === 'warn' ? (
                  <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}
                    className='flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium'
                    style={{ borderColor: 'color-mix(in srgb, var(--risk) 45%, transparent)', color: 'var(--risk)' }}>
                    <TriangleAlert size={12} /> 提示
                  </motion.span>
                ) : (
                  <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}
                    className='flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium text-ok'
                    style={{ borderColor: 'color-mix(in srgb, var(--success) 45%, transparent)' }}>
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

/** 候选收敛 → 自动选定（全片唯一 ElectricBorder 高潮） */
function CandidateResolver({ stage }: { stage: 'idle' | 'funnel' | 'selected' }): JSX.Element {
  return (
    <div className='panel flex min-h-0 flex-1 flex-col p-4'>
      <div className='mb-2 flex items-center justify-between'>
        <p className='t-caption'>{C.reschedule.candidatesTitle}</p>
        {stage !== 'idle' ? (
          <span className='chip text-[11px] tabular-nums'>{vm.candidateNames.length} 间可用 → 核验后 {vm.autoResolve.spaceRoomCount} 间</span>
        ) : null}
      </div>
      {stage === 'idle' ? (
        <div className='min-h-0 flex-1' />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className='min-h-0 flex-1'>
          <div className='flex flex-wrap content-start gap-x-1.5 gap-y-1'>
            {vm.candidateNames.slice(0, stage === 'selected' ? 0 : 12).map((n) => (
              <span key={n} className='rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-faint'>{n}</span>
            ))}
          </div>
          {stage === 'selected' && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE_OUT_SOFT }}
              className='mt-1 max-w-[300px]'>
              <ElectricBorder active borderRadius={16} chaos={0.16} speed={1.1}>
                <div className='rounded-[13px] bg-surface px-5 py-3.5'>
                  <p className='t-caption mb-0.5'>自动选定 · rank 1</p>
                  <p className='text-[26px] font-semibold tabular-nums' style={{ color: 'var(--brand-strong)' }}>{vm.autoResolve.suggested.name}</p>
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
 *  事实：lesson-001 数据结构 周一5-6@A1-201 → 周四7-8节；可行 + 连续4节提示；mutatedData=false。 */
export function HeroReschedule(): JSX.Element {
  const t = useHeroClock('hero-reschedule');
  const sourceOn = reached(t, at('resched.source'));
  const phase: Phase = !reached(t, at('resched.lift')) ? 'source' : reached(t, at('resched.snap')) ? 'snap' : 'lift';
  const constraintsAt = at('resched.constraints');
  const revealed = reached(t, constraintsAt) ? Math.min(vm.constraints.length, Math.floor((t - constraintsAt) * 1.15) + 1) : 0;
  const candStage = reached(t, at('resched.select')) ? 'selected' : reached(t, at('resched.candidates')) ? 'funnel' : 'idle';
  const decided = reached(t, at('resched.decision'));

  return (
    <div className='stage-safe flex w-full flex-col gap-4'>
      <SceneHeader
        kicker={C.reschedule.kicker}
        headline={C.reschedule.headline}
        sub={C.reschedule.sub}
        badge={<Badge tone='stream' icon={<FlaskConical size={14} />}>模拟调课 · What-if</Badge>}
      />

      <div className='grid min-h-0 flex-1 grid-cols-[1.15fr_1fr] gap-6'>
        {/* 左：手术台周板 + 免责小注 */}
        <div className='flex min-h-0 flex-col gap-3'>
          <div className='panel min-h-0 flex-1 p-4'>
            {sourceOn ? <SurgeryBoard phase={phase} showGhost={phase !== 'source'} /> : <div className='h-full' />}
          </div>
          <motion.p initial={{ opacity: 0 }} animate={constraintsAt <= t ? { opacity: 1 } : {}}
            className='t-caption px-1'>{C.reschedule.notice}</motion.p>
        </div>

        {/* 右：核验 → 收敛 → 判定 */}
        <div className='flex min-h-0 flex-col gap-4'>
          <VerifyMatrix revealed={revealed} />
          <CandidateResolver stage={candStage} />
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={decided ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease: EASE_OUT_SOFT }}
            className='panel flex items-center justify-between gap-4 border-l-2 px-5 py-3.5'
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