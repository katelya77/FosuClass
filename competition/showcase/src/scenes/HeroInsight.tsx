import { motion } from 'motion/react';
import { ChevronRight, TrendingUp } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { KineticMetric } from '../components/visual/KineticMetric';
import { useHeroClock, reached } from '../stores/directorStore';
import { INSIGHT_BEATS } from '../director/heroes/insightTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildInsightViewModel } from '../data/adapters/insightAdapter';
import { BlurIn } from '../components/visual/TextFx';
import { EASE_OUT } from '../motion/motionTokens';
import { HeroNarrative } from '../components/director/HeroNarrative';

const vm = buildInsightViewModel();
const at = (id: string) => INSIGHT_BEATS.find((b) => b.id === id)!.at;
const MAX = vm.ranking[0].lessons;

/** Rank Depth Field：十位教师按排名做纵向景深级联，Top1 拉前，其余后退。
 *  Phase 2.6：深度用 scale + opacity + 降饱和表达 —— 持久 blur 全部移除；
 *  blur 只允许存在于 0.45s 的抽取过渡本身。 */
function RankDepth({ entered, extracted }: { entered: boolean; extracted: boolean }): JSX.Element {
  return (
    <div className='relative flex min-h-0 flex-1 flex-col justify-center gap-2'>
      {vm.ranking.map((r, i) => {
        const isTop = r.rank === 1;
        const depth = extracted ? (isTop ? 1.05 : Math.max(0.94 - i * 0.008, 0.86)) : Math.max(1 - i * 0.016, 0.87);
        return (
          <motion.div
            key={r.teacherId}
            initial={{ opacity: 0, x: -22, scale: 0.92 }}
            animate={entered
              ? { opacity: extracted && !isTop ? 0.4 : 1, x: 0, scale: depth, filter: extracted && !isTop ? 'saturate(0.72)' : 'saturate(1)' }
              : { opacity: 0, x: -22, scale: 0.92 }}
            transition={extracted
              ? { duration: 0.45, ease: EASE_OUT }
              : { delay: i * 0.13, duration: 0.65, ease: EASE_OUT }}
            className={'flex items-center gap-3 rounded-xl border px-4 py-[10px] ' +
              (isTop && extracted ? 'border-[color-mix(in_srgb,var(--brand)_55%,transparent)] bg-[var(--brand-dim)] shadow-[var(--glow-brand)]' : 'border-[rgba(171,105,91,0.12)] bg-canvas-deep/55')}
            style={{ transformOrigin: 'left center' }}
          >
            <span className={'w-7 text-right text-[16px] tabular-nums ' + (isTop ? 'font-bold text-brand-strong' : 'text-mute')}>{r.rank}</span>
            <span className={'w-24 text-[16px] ' + (isTop ? 'font-semibold text-ink' : 'text-mute')}>{r.teacherId}</span>
            <div className='h-[12px] min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(171,105,91,0.14)]'>
              <motion.div
                className='h-full rounded-full'
                style={{ background: isTop ? 'var(--brand)' : 'color-mix(in srgb, var(--brand-secondary) 62%, transparent)' }}
                initial={{ width: 0 }}
                animate={entered ? { width: Math.max((r.lessons / MAX) * 100, 6) + '%' } : {}}
                transition={{ delay: 0.3 + i * 0.13, duration: 0.75, ease: EASE_OUT }}
              />
            </div>
            <span className='w-[112px] text-right text-[15px] tabular-nums text-mute'>{r.lessons}课/{r.periods}课时</span>
            {r.tied ? <span className='chip px-1.5 py-0 text-[12px]'>并列</span> : <span className='w-7' />}
          </motion.div>
        );
      })}
    </div>
  );
}

/** HeroInsight —— 全局排名可核查，个体风险可追踪。
 *  事实：第1–4周负载 Top10（教师025 56课/112课时 居首）；下钻=周课次14×4 + 冲突0/赶场4。
 *  Phase 2.6：单一 Primary Focus —— 下钻后 56/112 与风险链独占舞台。 */
export function HeroInsight(): JSX.Element {
  const t = useHeroClock('hero-insight');
  const cascade = reached(t, at('insight.cascade'));
  const top1 = reached(t, at('insight.top1'));
  const breadcrumb = reached(t, at('insight.breadcrumb'));
  const schedule = reached(t, at('insight.schedule'));
  const risk = reached(t, at('insight.risk'));
  const close = reached(t, at('insight.close'));

  return (
    <div className='stage-safe relative flex flex-col gap-4 pb-[58px] pt-[66px]'>
      <HeroNarrative
        t={t}
        question="未来四周谁最忙？"
        conclusion="排名负责发现，核验负责判断"
        verifyAt={at('insight.risk')}
        conclusionAt={at('insight.close')}
      />
      <SceneHeader
        size='headline'
        kicker={C.insight.kicker}
        headline={C.insight.headline}
        sub={C.insight.sub}
        badge={<Badge tone='brand' icon={<TrendingUp size={15} />}>{vm.windowLabel}</Badge>}
      />

      <div className='grid min-h-0 flex-1 min-w-0 grid-cols-[0.96fr_1.04fr] gap-7'>
        <motion.div
          className='plane material-topline flex min-h-0 min-w-0 flex-col py-4 pr-5'
          animate={{ opacity: risk ? 0.8 : 1, filter: risk ? 'saturate(0.85)' : 'saturate(1)' }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        >
          <p className='t-caption mb-2.5 px-5'>{C.insight.cascadeLabel}</p>
          <RankDepth entered={cascade} extracted={top1} />
        </motion.div>

        {/* 下钻：镜头推进式的证据链（内容垂直居中，杜绝 right 象限空缺；未到节拍不占位） */}
        <div className='relative flex min-h-0 min-w-0 flex-col justify-center gap-4'>
          {breadcrumb && (
            <motion.nav initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className='flex items-center gap-1.5 text-[14.5px]'>
              <span className='text-faint'>{C.insight.breadcrumbRoot}</span>
              <ChevronRight size={14} className='text-faint' />
              <span className='text-mute'>{C.insight.breadcrumbMid}</span>
              <ChevronRight size={14} className='text-faint' />
              <span className='font-medium text-brand'>{vm.top1.name}</span>
            </motion.nav>
          )}

          {/* Top1 锚点：56 / 112（Surface 2 hero focus） */}
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.92 }}
            animate={top1 ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.9, ease: EASE_OUT }}
            className='plane-hero depth-shift-near flex flex-col justify-around gap-5 px-10 py-8'
            style={{ boxShadow: top1 ? 'var(--shadow-glow-brand)' : 'var(--shadow-panel)' }}
          >
            <div className='flex items-center justify-between'>
              <p className='t-caption'>Top 1 · {vm.top1.name}</p>
              <Badge tone='brand'>负载峰值</Badge>
            </div>
            <div className='flex items-center justify-around'>
              <div className='text-center'>
                <KineticMetric to={vm.top1.lessons} settle={top1} className='t-metric-lg text-ink' />
                <p className='t-caption mt-1'>课次（第1–4周）</p>
              </div>
              <div className='text-center'>
                <KineticMetric to={vm.top1.periods} settle={top1} className='t-metric-lg text-stream' />
                <p className='t-caption mt-1'>课时</p>
              </div>
            </div>
            <p className='t-caption text-center'>连续 {vm.drilldownWeeks.length} 周 · 每周 {vm.drilldownWeeks[0]?.lessons ?? 0} 课次</p>
          </motion.div>

          {/* 周课次 temporal slab：柱体加高、数值加大 */}
          {schedule && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className='plane px-5 py-4'>
              <p className='t-caption mb-3'>{C.insight.weeksLabel}</p>
              <div className='flex items-end justify-between gap-4'>
                {vm.drilldownWeeks.map((w, i) => (
                  <div key={w.week} className='flex flex-1 flex-col items-center gap-2'>
                    <span className='text-[20px] font-bold tabular-nums text-ink'>{w.lessons}</span>
                    <div className='flex w-full items-end justify-center' style={{ height: 118 }}>
                      <motion.div
                        className='w-full origin-bottom rounded-t-lg'
                        style={{
                          height: 112,
                          background: 'linear-gradient(180deg, color-mix(in srgb, var(--brand) 88%, transparent), color-mix(in srgb, var(--brand) 40%, transparent))',
                          boxShadow: '0 0 28px -8px rgba(79,214,166,0.55)',
                        }}
                        initial={{ scaleY: 0 }}
                        animate={schedule ? { scaleY: 1 } : {}}
                        transition={{ delay: i * 0.16, duration: 0.6, ease: EASE_OUT }}
                      />
                    </div>
                    <span className='text-[15px] tabular-nums text-mute'>W{w.week} · {w.lessons}课</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* 风险摘要：下钻终点（与 Risk 场景同色语言） */}
          {risk && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE_OUT }}
              className='plane flex items-center justify-between gap-4 px-5 py-4'
              style={{ borderLeft: '3px solid var(--risk)', boxShadow: 'var(--shadow-panel), 0 0 30px -10px rgba(229,181,115,0.35)' }}>
              <div>
                <p className='text-[17px] font-semibold text-ink'>课程冲突 {vm.riskSummary.conflictCount} 处 · 跨校区赶场 {vm.riskSummary.rushWarningCount} 处</p>
                <p className='t-caption mt-1'>样例：{vm.riskSummary.sampleRoute} · {vm.riskSummary.gapMinutes} 分钟转场</p>
              </div>
              <Badge tone='risk'>待治理</Badge>
            </motion.div>
          )}
        </div>
      </div>

      <BlurIn delay={close ? 0.2 : 6} className="flex items-center justify-between gap-6">
        <p className='t-body text-mute'>{C.insight.closeLine}</p>
        <VerifiedSourcePill />
      </BlurIn>
    </div>
  );
}
