import { ArrowDown, Check, FlaskConical, Minus, ShieldAlert, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { Panel } from '../components/primitives/Panel';
import { rise } from '../components/primitives/motion';

const MINI_DAYS = ['一', '二', '三', '四', '五'];

/** What-if 徽章：模拟态永远显式 */
export function SimulationBadge(): JSX.Element {
  return (
    <Badge tone='stream' icon={<FlaskConical size={13} />}>What-if 模拟 · 未生效</Badge>
  );
}

/** 原方案 / What-if 方案对照 */
export function BeforeAfterSchedule(): JSX.Element {
  return (
    <Panel
      kicker='课次调整 · Reschedule'
      title='lesson-001 · 移动一门课次'
      badge={<Badge tone='neutral'>campus_reschedule_feasibility</Badge>}
      className='min-h-0 flex-1'
    >
      <div className='flex h-full flex-col justify-center gap-5'>
        <div>
          <p className='t-caption mb-2'>原方案</p>
          <div className='grid grid-cols-5 gap-2'>
            {MINI_DAYS.map((d) => (
              <div key={d} className='flex min-h-[64px] flex-col rounded-lg border border-line bg-canvas-deep p-1.5'>
                <span className='text-center text-[11px] text-faint'>{d}</span>
                {d === '一' && (
                  <div className='mt-1 rounded-md border border-line-strong bg-raised px-1.5 py-1 text-center text-[11px]'>
                    lesson-001
                    <br />1-2 节
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className='flex items-center justify-center gap-3 text-mute'>
          <ArrowDown size={16} className='rotate-[-90deg]' />
          <span className='t-caption'>移动至 周三 3-4 节（What-if）</span>
        </div>
        <div>
          <p className='t-caption mb-2'>What-if 方案</p>
          <div className='grid grid-cols-5 gap-2'>
            {MINI_DAYS.map((d) => (
              <div key={d} className='flex min-h-[64px] flex-col rounded-lg border border-line bg-canvas-deep p-1.5'>
                <span className='text-center text-[11px] text-faint'>{d}</span>
                {d === '三' && (
                  <motion.div
                    animate={{ opacity: [0.75, 1, 0.75] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                    className='mt-1 rounded-md border border-dashed border-stream px-1.5 py-1 text-center text-[11px] text-stream'
                  >
                    lesson-001
                    <br />3-4 节
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

interface ConstraintRow {
  label: string;
  status: 'ok' | 'warn' | 'na';
  note: string;
}

const CONSTRAINTS: ConstraintRow[] = [
  { label: '教师时间', status: 'ok', note: '该时段无既有课次' },
  { label: '班级时间', status: 'ok', note: '该时段无既有课次' },
  { label: '空间占用', status: 'warn', note: '目标教室待选定后核验' },
  { label: '容量与功能', status: 'na', note: '随教室选择联动' },
];

function StatusCell({ status }: { status: ConstraintRow['status'] }): JSX.Element {
  if (status === 'ok') return <span className='flex items-center gap-1.5 text-ok'><Check size={15} />可行</span>;
  if (status === 'warn') return <span className='flex items-center gap-1.5 text-riskc'><TriangleAlert size={15} />待核验</span>;
  return <span className='flex items-center gap-1.5 text-faint'><Minus size={15} />待选</span>;
}

/** 约束矩阵：教师 / 班级 / 空间 / 容量功能 */
export function ConstraintMatrix(): JSX.Element {
  return (
    <Panel kicker='约束检查 · Constraints' title='逐项核验，fail-closed'>
      <ul className='divide-y divide-[var(--border)]'>
        {CONSTRAINTS.map((c) => (
          <li key={c.label} className='flex items-center justify-between gap-4 py-3'>
            <span className='text-[15px] font-medium'>{c.label}</span>
            <span className='flex items-center gap-4'>
              <span className='t-caption'>{c.note}</span>
              <StatusCell status={c.status} />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** 教室选择结果占位（Phase 2 接真实输出） */
export function RoomSelectorResult(): JSX.Element {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Badge tone='stream'>目标教室 · 待选</Badge>
      <span className='t-caption'>Phase 2 接入 reschedule_feasibility 输出</span>
    </div>
  );
}

/** 风险提示条：模拟与真机的边界 */
export function RiskNotice(): JSX.Element {
  return (
    <div className='panel flex items-center gap-4 border-l-2 border-l-riskc px-6 py-4'>
      <ShieldAlert size={20} className='shrink-0 text-riskc' />
      <p className='t-body text-mute'>
        模拟<span className='font-medium text-ink'>不改变任何真实课表</span>；最终结论以腾讯 ADP 真机运行输出为准。
      </p>
    </div>
  );
}

export function HeroReschedule(): JSX.Element {
  return (
    <div className='stage-safe flex w-full flex-col gap-7'>
      <SceneHeader
        kicker='英雄场景 · 调课推演'
        title='What-if 调课：先推演，再决定'
        badge={<SimulationBadge />}
      />
      <div className='grid min-h-0 flex-1 grid-cols-2 gap-6'>
        <motion.div {...rise(0.55)} className='flex min-h-0 flex-col'>
          <BeforeAfterSchedule />
        </motion.div>
        <motion.div className='flex min-h-0 flex-col gap-6' {...rise(0.9)}>
          <ConstraintMatrix />
          <RoomSelectorResult />
        </motion.div>
      </div>
      <motion.div {...rise(1.25, 12)}>
        <RiskNotice />
      </motion.div>
    </div>
  );
}