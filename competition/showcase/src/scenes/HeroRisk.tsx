import { AlertTriangle, Clock3, MoveRight, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { Panel } from '../components/primitives/Panel';
import { rise } from '../components/primitives/motion';
import { heroesFixture } from '../fixtures/heroes';

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const GAP = heroesFixture.payload.riskGapMinutes;

/** 教师身份卡（Phase 2 接入 entity_search / schedule_query 实体） */
export function TeacherIdentity(): JSX.Element {
  return (
    <Panel kicker='教师 · Teacher' title='教师009' badge={<Badge icon={<UserRound size={13} />}>第 1 周</Badge>}>
      <div className='flex items-center gap-4'>
        <span className='flex size-14 items-center justify-center rounded-full border border-line bg-raised text-[22px] font-semibold tabular-nums text-brand'>
          09
        </span>
        <div className='t-caption leading-relaxed'>
          <p>跨校区授课 · 周五存在连续课次</p>
          <p>数据窗口 · 本学期第 1 周</p>
        </div>
      </div>
    </Panel>
  );
}

/** 周课条：冲突与赶场标记 */
export function ScheduleStrip(): JSX.Element {
  return (
    <Panel kicker='教师课表 · Schedule' title='第 1 周 · 冲突与赶场位置'>
      <div className='grid grid-cols-7 gap-2'>
        {DAYS.map((day) => {
          const isConflict = day === '周三';
          const isRush = day === '周五';
          return (
            <div key={day} className='flex min-h-[150px] flex-col gap-2'>
              <p className='t-caption text-center'>{day}</p>
              {isConflict && (
                <div className='rounded-md border border-dangerc/50 border-l-2 border-l-dangerc bg-raised px-2 py-1.5'>
                  <p className='text-[12px] font-medium'>lesson-018</p>
                  <p className='text-[11px] text-mute'>5-6 节 · 冲突</p>
                </div>
              )}
              {isRush && (
                <>
                  <div className='rounded-md border border-line bg-raised px-2 py-1.5'>
                    <p className='text-[12px] font-medium'>lesson-051</p>
                    <p className='text-[11px] text-mute'>3-4 节 · 校区A</p>
                  </div>
                  <div className='flex items-center justify-center rounded-md border border-riskc/40 bg-[var(--risk-dim)] px-1 py-0.5'>
                    <Clock3 size={11} className='mr-1 text-riskc' />
                    <span className='text-[11px] font-medium text-riskc'>{GAP} 分钟</span>
                  </div>
                  <div className='rounded-md border border-line bg-raised px-2 py-1.5'>
                    <p className='text-[12px] font-medium'>lesson-052</p>
                    <p className='text-[11px] text-mute'>5-6 节 · 校区B</p>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** 跨校区路线示意 */
export function CampusRoute(): JSX.Element {
  return (
    <Panel kicker='空间关系 · Campus Route' title='校区A → 校区B'>
      <div className='flex items-center gap-3 py-3'>
        <span className='chip shrink-0'>校区A</span>
        <div className='relative flex-1'>
          <div className='border-t border-dashed border-line-strong' />
          <MoveRight size={14} className='absolute -right-1 -top-[9px] text-mute' />
        </div>
        <span className='chip shrink-0 border-[color-mix(in_srgb,var(--risk)_42%,transparent)] text-riskc'>
          通勤 {GAP} 分钟
        </span>
        <span className='chip shrink-0'>校区B</span>
      </div>
      <p className='t-caption'>课间转场不可达 → 触发 rushWarning</p>
    </Panel>
  );
}

/** 大数字间隔计数器 */
export function GapCounter(): JSX.Element {
  return (
    <Panel raised kicker='最短转场间隔 · Gap' title=''>
      <div className='flex items-end gap-3 pb-1 pt-2'>
        <span className='t-metric text-riskc'>{GAP}</span>
        <span className='t-body pb-1.5 text-mute'>分钟</span>
      </div>
      <div className='hairline my-3' />
      <p className='t-caption'>lesson-051 → lesson-052 · 同一教师连续课次</p>
    </Panel>
  );
}

/** 风险结论卡 */
export function RiskCallout(): JSX.Element {
  return (
    <Panel
      kicker='风险发现 · Risk'
      title='赶场风险已被提前识别'
      badge={<Badge tone='risk' icon={<AlertTriangle size={13} />}>rushWarning × 1</Badge>}
      className='min-h-0 flex-1'
    >
      <ul className='t-body space-y-3 text-mute'>
        <li>
          <span className='font-medium text-ink'>时间冲突：</span>
          {heroesFixture.payload.conflictNote}
        </li>
        <li>
          <span className='font-medium text-ink'>赶场预警：</span>
          lesson-051 → lesson-052 仅隔 {GAP} 分钟，且跨越校区。
        </li>
      </ul>
      <div className='mt-5 flex flex-wrap gap-2'>
        <Badge tone='brand'>campus_risk_check</Badge>
        <Badge tone='stream'>week = 1</Badge>
        <Badge tone='neutral'>conflictCount = 1</Badge>
      </div>
    </Panel>
  );
}

export function HeroRisk(): JSX.Element {
  return (
    <div className='stage-safe flex w-full flex-col gap-7'>
      <SceneHeader
        kicker='英雄场景 · 风险发现'
        title='跨校区赶场，是如何被提前发现的'
        badge={<Badge tone='risk' icon={<AlertTriangle size={14} />}>风险发现</Badge>}
      />
      <motion.div className='grid min-h-0 flex-1 grid-cols-[430px_1fr] gap-6' {...rise(0.5)}>
        <motion.div className='flex min-h-0 flex-col gap-6' {...rise(0.8)}>
          <TeacherIdentity />
          <ScheduleStrip />
        </motion.div>
        <motion.div className='flex min-h-0 flex-col gap-6' {...rise(1.15)}>
          <div className='grid grid-cols-[300px_1fr] gap-6'>
            <GapCounter />
            <CampusRoute />
          </div>
          <RiskCallout />
        </motion.div>
      </motion.div>
    </div>
  );
}