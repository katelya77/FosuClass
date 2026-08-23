import { motion } from 'motion/react';
import { ChevronRight, TrendingUp } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { EASE_OUT_SOFT } from '../components/primitives/motion';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { CountUp } from '../vendor/react-bits/CountUp';
import { useHeroClock, reached } from '../stores/directorStore';
import { INSIGHT_BEATS } from '../director/heroes/insightTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildInsightViewModel } from '../data/adapters/insightAdapter';

const vm = buildInsightViewModel();
const at = (id: string) => INSIGHT_BEATS.find((b) => b.id === id)!.at;
const MAX = vm.ranking[0].lessons;

/** Rank Cascade：十条真实负载行，Top1 抽取后其余降调 */
function RankCascade({ entered, extracted }: { entered: boolean; extracted: boolean }): JSX.Element {
  return (
    <div className='flex min-h-0 flex-1 flex-col gap-1.5'>
      {vm.ranking.map((r, i) => {
        const isTop = r.rank === 1;
        return (
          <motion.div
            key={r.teacherId}
            initial={{ opacity: 0, x: -14 }}
            animate={entered
              ? { opacity: extracted && !isTop ? 0.32 : 1, x: 0 }
              : { opacity: 0, x: -14 }}
            transition={{ delay: i * 0.16, duration: 0.55, ease: EASE_OUT_SOFT }}
            className={'flex items-center gap-3 rounded-lg border px-3 py-[7px] ' +
              (isTop && extracted ? 'border-[color-mix(in_srgb,var(--brand)_50%,transparent)] bg-[var(--brand-dim)]' : 'border-line bg-canvas-deep/50')}
          >
            <span className={'w-6 text-right text-[13px] tabular-nums ' + (isTop ? 'font-semibold text-brand' : 'text-faint')}>{r.rank}</span>
            <span className={'w-20 text-[13.5px] ' + (isTop ? 'font-medium text-ink' : 'text-mute')}>{r.teacherId}</span>
            <div className='h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line'>
              <motion.div
                className='h-full rounded-full'
                style={{ background: isTop ? 'var(--brand)' : 'color-mix(in srgb, var(--brand-secondary) 65%, transparent)' }}
                initial={{ width: 0 }}
                animate={entered ? { width: Math.max((r.lessons / MAX) * 100, 6) + '%' } : {}}
                transition={{ delay: 0.3 + i * 0.16, duration: 0.7, ease: EASE_OUT_SOFT }}
              />
            </div>
            <span className='w-[86px] text-right text-[12.5px] tabular-nums text-mute'>{r.lessons}课/{r.periods}课时</span>
            {r.tied ? <span className='chip px-1.5 py-0 text-[10.5px]'>并列</span> : <span className='w-[38px]' />}
          </motion.div>
        );
      })}
    </div>
  );
}

/** HeroInsight —— 宏观排名可核查，个体风险可追踪。
 *  事实：第1–4周负载 Top10（教师025 56课/112课时 居首）；下钻=周课次14×4 + 冲突0/赶场4。 */
export function HeroInsight(): JSX.Element {
  const t = useHeroClock('hero-insight');
  const cascade = reached(t, at('insight.cascade'));
  const top1 = reached(t, at('insight.top1'));
  const breadcrumb = reached(t, at('insight.breadcrumb'));
  const schedule = reached(t, at('insight.schedule'));
  const risk = reached(t, at('insight.risk'));
  const close = reached(t, at('insight.close'));

  return (
    <div className='stage-safe flex w-full flex-col gap-5'>
      <SceneHeader
        kicker={C.insight.kicker}
        headline={C.insight.headline}
        sub={C.insight.sub}
        badge={<Badge tone='brand' icon={<TrendingUp size={14} />}>{vm.windowLabel}</Badge>}
      />

      <div className='grid min-h-0 flex-1 grid-cols-[1.1fr_1fr] gap-8'>
        {/* 左：Rank Cascade */}
        <div className='panel flex min-h-0 flex-col p-4'>
          <p className='t-caption mb-3'>{C.insight.cascadeLabel}</p>
          <RankCascade entered={cascade} extracted={top1} />
        </div>

        {/* 右：下钻证据链 */}
        <div className='flex min-h-0 flex-col gap-4'>
          {/* 面包屑 */}
          <motion.nav initial={{ opacity: 0, y: -6 }} animate={breadcrumb ? { opacity: 1, y: 0 } : {}}
            className='flex items-center gap-1.5 text-[13px]'>
            <span className='text-faint'>{C.insight.breadcrumbRoot}</span>
            <ChevronRight size={13} className='text-faint' />
            <span className='text-mute'>{C.insight.breadcrumbMid}</span>
            <ChevronRight size={13} className='text-faint' />
            <span className='font-medium text-brand'>{vm.top1.name}</span>
          </motion.nav>

          {/* Top1 指标 */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={top1 ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease: EASE_OUT_SOFT }}
            className='panel-raised flex items-center justify-around px-6 py-4'>
            <div className='text-center'>
              {top1 ? <CountUp to={vm.top1.lessons} duration={1.5} className='t-metric block text-ink' /> : <span className='t-metric block text-faint'>—</span>}
              <p className='t-caption mt-1'>课次（第1–4周）</p>
            </div>
            <div className='text-center'>
              {top1 ? <CountUp to={vm.top1.periods} duration={1.5} delay={0.4} className='t-metric block text-stream' /> : <span className='t-metric block text-faint'>—</span>}
              <p className='t-caption mt-1'>课时</p>
            </div>
          </motion.div>

          {/* 周课次分布 */}
          <motion.div initial={{ opacity: 0 }} animate={schedule ? { opacity: 1 } : {}} className='panel px-5 py-4'>
            <p className='t-caption mb-2.5'>{C.insight.weeksLabel}</p>
            <div className='flex items-end justify-between gap-4'>
              {vm.drilldownWeeks.map((w, i) => (
                <div key={w.week} className='flex flex-1 flex-col items-center gap-1.5'>
                  <motion.div
                    className='w-full origin-bottom rounded-t-md bg-[color-mix(in_srgb,var(--brand)_75%,transparent)]'
                    style={{ height: 46 }}
                    initial={{ scaleY: 0 }}
                    animate={schedule ? { scaleY: 1 } : {}}
                    transition={{ delay: i * 0.18, duration: 0.6, ease: EASE_OUT_SOFT }}
                  />
                  <span className='text-[11.5px] tabular-nums text-mute'>W{w.week} · {w.lessons}课</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* 风险摘要 */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={risk ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease: EASE_OUT_SOFT }}
            className='panel flex items-center justify-between gap-4 border-l-2 px-5 py-3'
            style={{ borderLeftColor: 'var(--risk)' }}>
            <div>
              <p className='text-[14.5px] text-ink'>课程冲突 {vm.riskSummary.conflictCount} 处 · 跨校区赶场 {vm.riskSummary.rushWarningCount} 处</p>
              <p className='t-caption mt-0.5'>样例：{vm.riskSummary.sampleRoute} · {vm.riskSummary.gapMinutes} 分钟转场</p>
            </div>
            <Badge tone='risk'>待治理</Badge>
          </motion.div>
        </div>
      </div>

      <motion.footer initial={{ opacity: 0, y: 10 }} animate={close ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8 }}
        className='flex items-center justify-between gap-6'>
        <p className='t-body text-mute'>{C.insight.closeLine}</p>
        <VerifiedSourcePill />
      </motion.footer>
    </div>
  );
}