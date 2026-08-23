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
import { BlurIn } from '../components/visual/TextFx';

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
  const routesShown = reached(t, routesAt) ? Math.min(vm.rushLinks.length, Math.floor((t - routesAt) * 0.9) + 1) : 0;
  const warning = reached(t, at('risk.warning'));
  const summary = reached(t, at('risk.summary'));
  const routesDone = routesShown >= vm.rushLinks.length;

  return (
    <div className='stage-safe flex flex-col gap-4'>
      <SceneHeader
        size='headline'
        kicker={C.risk.kicker}
        headline={C.risk.headline}
        sub={C.risk.sub}
        badge={warning ? <Badge tone='risk' icon={<AlertTriangle size={15} />}>{C.risk.contrastRisk}</Badge> : <Badge tone='brand'>时间 × 空间</Badge>}
      />

      {identity && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className='depth-shift flex items-center gap-5'>
          <span className='flex size-14 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--brand)_40%,transparent)] bg-[var(--brand-dim)] text-[20px] font-bold tabular-nums text-brand-strong shadow-[var(--glow-brand)]'>25</span>
          <div>
            <p className='t-card-title'>{vm.teacherName}</p>
            <p className='t-caption'>{C.risk.identityRole}</p>
          </div>
          <div className='ml-6 flex items-center gap-10'>
            <div>
              <KineticMetric to={vm.totals.conflictCount} settle={warning} className='t-metric text-ok' />
              <p className='t-caption mt-0.5'>课程冲突</p>
            </div>
            <div>
              <KineticMetric to={vm.totals.rushWarningCount} settle={warning} className='t-metric text-riskc' />
              <p className='t-caption mt-0.5'>跨校区赶场</p>
            </div>
          </div>
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

      <BlurIn delay={summary ? 0.2 : 3} className="flex items-end justify-between gap-6">
        <div>
          <p className='t-body text-mute'>{C.risk.summary}</p>
          <div className='mt-2 flex items-center gap-2'>
            {vm.perWeekRisk.map((w) => (
              <span key={w.week} className='chip text-[14px] tabular-nums'>
                W{w.week} · 冲突{w.conflictCount} / 赶场{w.rushWarningCount}
              </span>
            ))}
          </div>
        </div>
        <VerifiedSourcePill />
      </BlurIn>
    </div>
  );
}
