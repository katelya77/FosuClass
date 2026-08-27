import { motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { RiskField } from '../components/hero/RiskField';
import { KineticMetric } from '../components/visual/KineticMetric';
import { useHeroClock, reached } from '../stores/directorStore';
import { RISK_BEATS } from '../director/heroes/riskTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildRiskViewModel } from '../data/adapters/riskAdapter';
import { HeroNarrative } from '../components/director/HeroNarrative';

const vm = buildRiskViewModel();
const at = (id: string) => RISK_BEATS.find((b) => b.id === id)!.at;

/** HeroRisk —— 视觉隐喻：时间 × 空间 的二维教学时空场。
 *  事实：教师025 · 未来四周 · 每周14课次 · 课程冲突0 · 跨校区赶场4（每段20分钟）。
 *  Phase 2.6：上层=身份+核心 Metric（0/4），中层=周课程时间结构，下层=校区空间+赶场弧；
 *  路径出现时对应课程块同步点亮 —— 时间与空间是一张图。 */
export function HeroRisk(): JSX.Element {
  const t = useHeroClock('hero-risk');
  const identity = reached(t, at('risk.identity'));
  const schedule = reached(t, at('risk.schedule'));
  const campuses = reached(t, at('risk.campuses'));
  const routesAt = at('risk.routes');
  const routesShown = reached(t, routesAt) ? Math.min(vm.rushLinks.length, Math.floor((t - routesAt) / 1.4) + 1) : 0;
  const warning = reached(t, at('risk.warning'));
  const summary = reached(t, at('risk.summary'));
  const routesDone = routesShown >= vm.rushLinks.length;

  return (
    <div className='stage-safe relative flex flex-col gap-4 pb-[58px] pt-[66px]'>
      <HeroNarrative
        t={t}
        question="教师025未来四周有没有风险？"
        conclusion="没有冲突，不代表没有风险"
        verifyAt={at('risk.routes')}
        conclusionAt={at('risk.summary')}
      />
      <SceneHeader
        size='headline'
        kicker={C.risk.kicker}
        headline={C.risk.headline}
        sub={C.risk.sub}
        badge={warning ? <Badge tone='risk' icon={<AlertTriangle size={15} />}>{C.risk.contrastRisk}</Badge> : <Badge tone='brand'>时间 × 空间</Badge>}
      />

      {identity && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className='risk-identity depth-shift flex w-full items-center justify-between gap-6'>
          <div className='flex items-center gap-5'>
            <span className='flex size-16 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--brand)_45%,transparent)] bg-[var(--brand-dim)] text-[22px] font-bold tabular-nums text-brand-strong shadow-[var(--glow-brand)]'>25</span>
            <div>
              <p className='t-card-title'>{vm.teacherName}</p>
              <p className='t-caption'>{C.risk.identityRole}</p>
            </div>
          </div>
          {summary ? (
            <motion.div
              className='risk-result-metrics grid min-w-0 flex-1 grid-cols-3 gap-3'
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.72 }}
              data-qa-risk-summary
            >
              <div className='risk-result-metric'>
                <KineticMetric to={vm.totals.conflictCount} settle={warning} className='risk-result-number text-ok' />
                <p>课程冲突</p>
              </div>
              <div className='risk-result-metric is-warning'>
                <KineticMetric to={vm.totals.rushWarningCount} settle={warning} className='risk-result-number text-riskc' />
                <p>转场预警</p>
              </div>
              <div className='risk-result-metric is-window'>
                <span className='risk-result-number text-brand-strong'>20</span>
                <span className='risk-result-unit'>min</span>
                <p>最短转场窗口</p>
              </div>
            </motion.div>
          ) : (
            <div className='rounded-full border border-line bg-white/45 px-5 py-2 text-[15px] font-semibold text-mute'>未来四周 · 联合检查时间与教学空间</div>
          )}
        </motion.div>
      )}

      <div className='relative min-h-0 flex-1'>
        <div className='relative h-full'>
          <RiskField
            vm={vm}
            showBlocks={schedule}
            showCampus={campuses}
            rushVisibleFrom={routesShown}
            showRoutes={routesDone}
            dim={routesDone}
          />
        </div>
      </div>

      {summary && (
        <motion.p className='t-body text-mute' initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {C.risk.summary}
        </motion.p>
      )}
      <VerifiedSourcePill />
    </div>
  );
}
