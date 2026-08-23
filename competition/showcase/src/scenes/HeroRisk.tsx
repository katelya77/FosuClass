import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { rise } from '../components/primitives/motion';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { ScheduleRail } from '../components/hero/ScheduleRail';
import { useHeroClock, reached } from '../stores/directorStore';
import { RISK_BEATS } from '../director/heroes/riskTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildRiskViewModel } from '../data/adapters/riskAdapter';

const vm = buildRiskViewModel();
const at = (id: string) => RISK_BEATS.find((b) => b.id === id)!.at;

/** HeroRisk —— 视觉隐喻：时间轨上的隐形空间风险。
 *  故事：无课程冲突 × 4 处跨校区赶场（教师025 · 第1–4周 · 大学英语） */
export function HeroRisk(): JSX.Element {
  const t = useHeroClock('hero-risk');
  const identity = reached(t, at('risk.identity'));
  const schedule = reached(t, at('risk.schedule'));
  const campuses = reached(t, at('risk.campuses'));
  const routesAt = at('risk.routes');
  const routesShown = reached(t, routesAt) ? Math.min(vm.rushLinks.length, Math.floor((t - routesAt) * 0.9) + 1) : 0;
  const gap = reached(t, at('risk.gap'));
  const warning = reached(t, at('risk.warning'));
  const summary = reached(t, at('risk.summary'));

  return (
    <div className='stage-safe flex w-full flex-col gap-5'>
      <SceneHeader
        kicker={C.risk.kicker}
        headline={C.risk.headline}
        sub={C.risk.sub}
        badge={warning ? <Badge tone='risk' icon={<AlertTriangle size={14} />}>{C.risk.contrastRisk}</Badge> : undefined}
      />

      {/* 教师身份行 */}
      {identity && (
        <motion.div {...rise(0.05, 10)} className='flex items-center gap-4'>
          <span className='flex size-12 items-center justify-center rounded-full border border-line bg-raised text-[17px] font-semibold tabular-nums text-brand'>25</span>
          <div>
            <p className='t-card-title'>{vm.teacherName}</p>
            <p className='t-caption'>{C.risk.identityRole}</p>
          </div>
          {warning && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}
              className='ml-2 flex items-center gap-1.5 text-[14px] text-ok'>
              <CheckCircle2 size={15} />
              {C.risk.contrastSafe}
            </motion.span>
          )}
        </motion.div>
      )}

      {/* 时间轨主体 + 风险光晕 */}
      <div className='relative min-h-0 flex-1'>
        {warning && (
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.85, 0.55] }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
            className='pointer-events-none absolute -inset-2 rounded-2xl'
            style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--risk) 45%, transparent)', background: 'var(--risk-dim)' }}
          />
        )}
        <div className='relative h-full'>
          <ScheduleRail
            vm={vm}
            showBlocks={schedule}
            showCampusColor={campuses}
            rushVisibleFrom={routesShown}
            showGap={gap}
          />
        </div>
      </div>

      {/* 底部：反差结论 + 逐周证据 + 来源 */}
      <motion.footer
        initial={{ opacity: 0, y: 12 }}
        animate={summary ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className='flex items-end justify-between gap-6'
      >
        <div>
          <p className='t-body text-mute'>{C.risk.summary}</p>
          <div className='mt-2 flex items-center gap-2'>
            {vm.perWeekRisk.map((w) => (
              <span key={w.week} className='chip text-[11.5px] tabular-nums'>
                W{w.week} · 冲突{w.conflictCount} / 赶场{w.rushWarningCount}
              </span>
            ))}
          </div>
        </div>
        <VerifiedSourcePill />
      </motion.footer>
    </div>
  );
}