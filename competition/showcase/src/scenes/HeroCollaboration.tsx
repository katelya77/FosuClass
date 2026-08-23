import { motion } from 'motion/react';
import { Users } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { rise, EASE_OUT_SOFT } from '../components/primitives/motion';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { CountUp } from '../vendor/react-bits/CountUp';
import { useHeroClock, reached } from '../stores/directorStore';
import { COLLAB_BEATS } from '../director/heroes/collaborationTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildCollaborationViewModel } from '../data/adapters/collaborationAdapter';

const vm = buildCollaborationViewModel();
const at = (id: string) => COLLAB_BEATS.find((b) => b.id === id)!.at;
const DAYS = ['周一', '周二', '周三', '周四', '周五'];

/** 三条 Lane × 五天上午矩阵；周四列 = 唯一共同空闲 */
function LaneMatrix({ showBusy, intersection, expanded }: { showBusy: boolean; intersection: boolean; expanded: boolean }): JSX.Element {
  return (
    <div className='flex h-full flex-col'>
      <div className='mb-2 grid grid-cols-[96px_repeat(5,1fr)] gap-1.5'>
        <span />
        {DAYS.map((d) => (
          <span key={d} className={'text-center text-[12px] tracking-widest ' + (intersection && d === '周四' ? 'font-medium text-brand' : 'text-faint')}>{d}</span>
        ))}
      </div>
      <div className='relative min-h-0 flex-1'>
        {/* 周四共同空闲列光带 */}
        <motion.div
          aria-hidden
          className='absolute bottom-0 top-0 rounded-xl border-x-2 border-brand bg-[var(--brand-dim)]'
          style={{ left: 'calc(96px + (100% - 96px - 6 * 6px) * 3 / 5 + 18px)', width: 'calc((100% - 96px - 36px) / 5)' }}
          initial={{ opacity: 0, scaleY: 0.4 }}
          animate={intersection ? { opacity: 1, scaleY: 1 } : { opacity: 0, scaleY: 0.4 }}
          transition={{ duration: 0.9, ease: EASE_OUT_SOFT }}
        />
        {/* Lanes */}
        <div className='relative z-10 flex h-full flex-col justify-between gap-2 py-0.5'>
          {vm.lanes.map((lane, li) => (
            <motion.div key={lane.teacher} {...rise(0.15 + li * 0.22, 12)} className='grid grid-cols-[96px_repeat(5,1fr)] items-center gap-1.5'>
              <span className='truncate pr-2 text-right text-[13px] text-mute'>{lane.teacher}</span>
              {DAYS.map((_, di) => {
                const busy = lane.busy.find((b) => b.weekday === di + 1);
                return (
                  <div key={di} className='relative h-11 overflow-hidden rounded-lg border border-line bg-canvas-deep'>
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={showBusy && busy ? { scaleX: 1 } : { scaleX: 0 }}
                      transition={{ delay: 0.25 + di * 0.14, duration: 0.55, ease: EASE_OUT_SOFT }}
                      className='absolute inset-y-1 left-1 right-1 origin-left rounded-md border border-line-strong bg-raised'
                    >
                      <span className='absolute inset-0 flex items-center justify-center text-[10.5px] text-faint'>已占用</span>
                    </motion.div>
                  </div>
                );
              })}
            </motion.div>
          ))}
        </div>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE_OUT_SOFT }}
            className='absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2'
          >
            <span className='chip border-[color-mix(in_srgb,var(--brand)_50%,transparent)] bg-canvas-deep/90 text-brand'>
              {vm.slot.weekdayName} · {vm.slot.periodText} · {vm.slot.timeText}
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** HeroCollaboration —— 视觉隐喻：多人的时间交集，落成真实空间方案。
 *  事实：教师005/006/014 第1周唯一共同空闲=周四第1-4节；63间可用→≥120座7间→推荐 A1-201(120)。 */
export function HeroCollaboration(): JSX.Element {
  const t = useHeroClock('hero-collaboration');
  const lanesOn = reached(t, at('collab.lanes'));
  const busy = reached(t, at('collab.busy'));
  const intersection = reached(t, at('collab.intersection'));
  const expanded = reached(t, at('collab.expand'));
  const rooms = reached(t, at('collab.rooms'));
  const recommend = reached(t, at('collab.recommend'));
  const verdict = reached(t, at('collab.verdict'));

  return (
    <div className='stage-safe flex w-full flex-col gap-5'>
      <SceneHeader
        kicker={C.collaboration.kicker}
        headline={C.collaboration.headline}
        sub={C.collaboration.sub}
        badge={<Badge tone='brand' icon={<Users size={14} />}>协同规划</Badge>}
      />

      <div className='grid min-h-0 flex-1 grid-cols-[1.05fr_1fr] gap-8'>
        {/* 左：Lane 矩阵 */}
        <div className='panel flex min-h-0 flex-col p-5'>
          <p className='t-caption mb-3'>{C.collaboration.lanesLabel}</p>
          {lanesOn ? <LaneMatrix showBusy={busy} intersection={intersection} expanded={expanded} /> : <div className='min-h-0 flex-1' />}
        </div>

        {/* 右：空间收敛漏斗 → 推荐 */}
        <div className='flex min-h-0 flex-col gap-4'>
          <motion.div {...rise(0.1)} className='panel-raised flex items-center justify-around px-6 py-4'>
            <div className='text-center'>
              {rooms ? <CountUp to={vm.funnel.allRoomsAvailable} duration={1.4} className='t-metric block text-ink' /> : <span className='t-metric block text-faint'>—</span>}
              <p className='t-caption mt-1'>{C.collaboration.funnelAll}</p>
            </div>
            <motion.span initial={{ opacity: 0 }} animate={rooms ? { opacity: 1 } : {}} className='text-[22px] text-faint'>→</motion.span>
            <div className='text-center'>
              {rooms ? <CountUp to={vm.funnel.capacity120Plus} duration={1.2} delay={0.9} className='t-metric block text-stream' /> : <span className='t-metric block text-faint'>—</span>}
              <p className='t-caption mt-1'>{C.collaboration.funnelCap}</p>
            </div>
          </motion.div>

          {/* 候选 chips */}
          <motion.div initial={{ opacity: 0 }} animate={rooms ? { opacity: 1 } : {}} className='flex flex-wrap gap-1.5 px-1'>
            {vm.candidatesCap120.map((r) => (
              <span key={r.name} className={'chip text-[11.5px] ' + (r.name === vm.recommended.name ? 'border-[color-mix(in_srgb,var(--brand)_50%,transparent)] text-brand' : '')}>
                {r.name} · {r.capacity}座
              </span>
            ))}
          </motion.div>

          {/* 推荐主卡 */}
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={recommend ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
            className='panel-raised flex flex-1 flex-col justify-center gap-2 px-7 py-5'
            style={{ borderColor: recommend ? 'color-mix(in srgb, var(--brand) 45%, transparent)' : undefined }}
          >
            <p className='t-caption'>推荐空间 · rank 1</p>
            <p className='t-section !text-[34px]' style={{ color: 'var(--brand-strong)' }}>{vm.recommended.name}</p>
            <div className='flex flex-wrap gap-2'>
              <Badge tone='brand'>{vm.recommended.campusName}</Badge>
              <Badge>{vm.recommended.building}</Badge>
              <Badge>{vm.recommended.type} · {vm.recommended.capacity} 座</Badge>
            </div>
          </motion.div>
        </div>
      </div>

      <motion.footer
        initial={{ opacity: 0, y: 10 }}
        animate={verdict ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8 }}
        className='flex items-center justify-between gap-6'
      >
        <p className='t-body text-mute'>{C.collaboration.verdict}</p>
        <VerifiedSourcePill />
      </motion.footer>
    </div>
  );
}