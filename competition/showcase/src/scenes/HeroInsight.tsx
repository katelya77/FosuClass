import { BarChart3, ChevronRight, ListChecks } from 'lucide-react';
import { motion } from 'motion/react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { Panel } from '../components/primitives/Panel';
import { rise } from '../components/primitives/motion';
import { heroesFixture } from '../fixtures/heroes';

const TOP = heroesFixture.payload.topLoad;
const SECOND = heroesFixture.payload.secondLoad;

interface RankRowProps {
  rank: number;
  name: string;
  lessons: number;
  periods: number;
  tie?: boolean;
  focus?: boolean;
  delay?: number;
}

/** 排行行（RankFocus 通过 focus 高亮 Top1） */
export function RankingBoard(): JSX.Element {
  return (
    <Panel
      kicker='全局负载排行 · Insight'
      title='教师负载 · 第 1–4 周窗口'
      badge={<Badge tone='brand'>campus_teacher_load_query</Badge>}
      className='min-h-0 flex-1'
    >
      <div className='flex h-full flex-col justify-center gap-4'>
        <RankRow rank={TOP.rank} name={TOP.teacherId} lessons={TOP.lessons} periods={TOP.periods} tie focus delay={0.9} />
        <RankRow rank={SECOND.rank} name={SECOND.teacherId} lessons={SECOND.lessons} periods={SECOND.periods} tie delay={1.2} />
        <div className='flex items-center justify-between rounded-xl border border-dashed border-line px-5 py-4 text-faint'>
          <span className='t-metric text-[22px]'>3</span>
          <span className='t-caption'>下一名 · Phase 2 由 Golden 导出完整榜单</span>
        </div>
      </div>
    </Panel>
  );
}

function RankRow({ rank, name, lessons, periods, tie, focus, delay = 0 }: RankRowProps): JSX.Element {
  return (
    <motion.div
      {...rise(delay, 12)}
      className={focus ? 'relative rounded-xl border border-brand/50 bg-[var(--brand-dim)] px-5 py-4' : 'rounded-xl border border-line px-5 py-4'}
    >
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-baseline gap-4'>
          <span className={'t-metric ' + (focus ? 'text-brand' : '')}>{rank}</span>
          <div>
            <p className='t-card-title'>{name}</p>
            <p className='t-caption'>
              {lessons} 次授课 · {periods} 课时
            </p>
          </div>
        </div>
        {tie && <Badge tone='stream'>并列最高 · 稳定排序</Badge>}
      </div>
      <div className='mt-3 h-1.5 overflow-hidden rounded-full bg-canvas-deep'>
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: delay + 0.3, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className={'h-full origin-left rounded-full ' + (focus ? 'bg-brand' : 'bg-line-strong')}
        />
      </div>
    </motion.div>
  );
}

/** 下钻面包屑 */
export function DrilldownBreadcrumb(): JSX.Element {
  const steps = ['全校负载排行', TOP.teacherId, '第 1–4 周'];
  return (
    <Panel kicker='下钻路径 · Drilldown' title=''>
      <div className='flex flex-wrap items-center gap-2'>
        {steps.map((s, i) => (
          <span key={s} className='flex items-center gap-2'>
            {i > 0 && <ChevronRight size={14} className='text-faint' />}
            <span className={'chip ' + (i === steps.length - 1 ? 'border-[color-mix(in_srgb,var(--brand)_45%,transparent)] text-brand' : '')}>{s}</span>
          </span>
        ))}
      </div>
    </Panel>
  );
}

/** 迷你课表（聚合视图，不虚构单周分布） */
export function MiniSchedule(): JSX.Element {
  return (
    <Panel kicker='Top1 课表 · Schedule Range' title='第 1–4 周覆盖'>
      <div className='grid grid-cols-4 gap-2'>
        {['W1', 'W2', 'W3', 'W4'].map((w, i) => (
          <motion.div
            key={w}
            {...rise(0.9 + i * 0.18, 10)}
            className='rounded-lg border border-line bg-canvas-deep p-2 text-center'
          >
            <p className='text-[11px] tracking-widest text-faint'>{w}</p>
            <div className='mx-auto mt-2 flex h-8 w-full max-w-[52px] items-end justify-center gap-[3px]'>
              {[0.5, 0.85, 0.65, 1].map((h, j) => (
                <span key={j} className='w-1.5 rounded-sm bg-brand/60' style={{ height: Math.round(h * 100) + '%' }} />
              ))}
            </div>
          </motion.div>
        ))}
      </div>
      <p className='t-caption mt-3'>
        {TOP.lessons} 次授课 · {TOP.periods} 课时 · campus_schedule_range_query 可继续下钻单日明细
      </p>
    </Panel>
  );
}

/** 下钻后的风险小结入口 */
export function RiskSummary(): JSX.Element {
  return (
    <Panel kicker='后续动作 · Next' title=''>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge tone='brand' icon={<ListChecks size={13} />}>查看课表</Badge>
        <Badge tone='risk'>检查风险</Badge>
      </div>
      <p className='t-caption mt-3'>sys.chat 动作语义 · 下钻后可继续追问，状态跨域继承</p>
    </Panel>
  );
}

export function HeroInsight(): JSX.Element {
  return (
    <div className='stage-safe flex w-full flex-col gap-7'>
      <SceneHeader
        kicker='英雄场景 · 全局洞察'
        title='负载排行 → Top1 → 下钻课表'
        badge={<Badge tone='stream' icon={<BarChart3 size={14} />}>校园洞察</Badge>}
      />
      <div className='grid min-h-0 flex-1 grid-cols-[1.15fr_1fr] gap-6'>
        <RankingBoard />
        <motion.div className='flex min-h-0 flex-col gap-5' {...rise(0.7)}>
          <DrilldownBreadcrumb />
          <MiniSchedule />
          <RiskSummary />
        </motion.div>
      </div>
    </div>
  );
}