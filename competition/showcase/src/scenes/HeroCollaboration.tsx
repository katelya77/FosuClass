import { motion } from 'motion/react';
import { Users, ArrowRight } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { VerifiedSourcePill } from '../components/visual/VerifiedSourcePill';
import { KineticMetric } from '../components/visual/KineticMetric';
import { useHeroClock, reached } from '../stores/directorStore';
import { COLLAB_BEATS } from '../director/heroes/collaborationTimeline';
import { HERO_COPY as C } from '../content/heroCopy';
import { buildCollaborationViewModel } from '../data/adapters/collaborationAdapter';
import { BlurIn } from '../components/visual/TextFx';
import { EASE_OUT } from '../motion/motionTokens';

const vm = buildCollaborationViewModel();
const at = (id: string) => COLLAB_BEATS.find((b) => b.id === id)!.at;
const DAYS = ['周一', '周二', '周三', '周四', '周五'];

/** 三条 Lane × 五天上午矩阵 + 时间扫描器 + 共同空闲汇聚。
 *  Phase 2.6：行距收紧、格子更亮；共同空闲列点亮后成为画面唯一焦点。 */
function LaneScanner({ showBusy, intersection, expanded }: { showBusy: boolean; intersection: boolean; expanded: boolean }): JSX.Element {
  return (
    <div className='flex h-full flex-col'>
      <div className='mb-2.5 grid grid-cols-[112px_repeat(5,1fr)] gap-2'>
        <span />
        {DAYS.map((d) => (
          <span key={d} className={'text-center text-[15px] tracking-widest ' + (intersection && d === '周四' ? 'font-semibold text-brand-strong' : 'text-mute')}>{d}</span>
        ))}
      </div>
      <div className='relative min-h-0 flex-1 rounded-2xl bg-canvas-deep/40 p-4'>
        {/* 周四共同空闲列：扫描到后点亮 */}
        <motion.div
          aria-hidden
          className='absolute bottom-3 top-3 rounded-2xl border-x-2 border-brand bg-[var(--brand-dim)]'
          style={{ left: 'calc(112px + (100% - 112px - 5*8px) * 3 / 5 + 16px)', width: 'calc((100% - 112px - 40px) / 5)', boxShadow: '0 0 44px -10px rgba(79,214,166,0.45)' }}
          initial={{ opacity: 0, scaleY: 0.5 }}
          animate={intersection ? { opacity: 1, scaleY: 1 } : { opacity: 0, scaleY: 0.5 }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
        />
        {/* 时间扫描器：自左向右逐列 */}
        {!expanded && (
          <motion.div
            aria-hidden
            className='absolute top-2 bottom-2 w-[calc((100% - 112px - 40px)/5)] rounded-lg'
            style={{ background: 'linear-gradient(180deg, rgba(138,238,201,0.12), rgba(138,238,201,0.035))', borderLeft: '1px solid rgba(138,238,201,0.55)', borderRight: '1px solid rgba(138,238,201,0.55)' }}
            initial={{ left: 'calc(112px + 8px)' }}
            animate={{ left: 'calc(112px + (100% - 112px - 40px) * 4 / 5 + 8px)' }}
            transition={{ delay: 1.2, duration: 2.4, ease: 'easeInOut' }}
          />
        )}
        {/* Lanes：紧凑居中，不再纵向摊开 */}
        <div className='relative z-10 flex h-full flex-col justify-center gap-4'>
          {vm.lanes.map((lane, li) => (
            <motion.div key={lane.teacher} initial={{ opacity: 0, y: 14 }} animate={intersection || showBusy ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.2 + li * 0.2, duration: 0.7, ease: EASE_OUT }} className='grid grid-cols-[112px_repeat(5,1fr)] items-center gap-2'>
              <span className='truncate pr-2 text-right text-[15px] text-mute'>{lane.teacher}</span>
              {DAYS.map((d, di) => {
                const busy = lane.busy.find((b) => b.weekday === di + 1);
                return (
                  <div key={di} className='relative h-[52px] overflow-hidden rounded-xl border border-[rgba(168,184,204,0.14)] bg-canvas-deep'>
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={showBusy && busy ? { scaleX: 1 } : { scaleX: 0 }}
                      transition={{ delay: 0.3 + di * 0.16, duration: 0.55, ease: EASE_OUT }}
                      className='absolute inset-y-1 left-1 right-1 origin-left rounded-lg bg-[#0a0e15] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                    >
                      <span className='absolute inset-0 flex items-center justify-center text-[13.5px] text-faint'>已占用</span>
                    </motion.div>
                    {/* 共同空闲：周四列这三格被点亮 */}
                    {intersection && d === '周四' && (
                      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className='absolute inset-0 flex items-center justify-center text-[14px] font-semibold text-brand-strong'>
                        空闲
                      </motion.span>
                    )}
                  </div>
                );
              })}
            </motion.div>
          ))}
        </div>
        {expanded && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE_OUT }} className='absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2'>
            <span className='chip border-[color-mix(in_srgb,var(--brand)_55%,transparent)] bg-canvas-deep/95 text-[14px] font-medium text-brand-strong shadow-[var(--glow-brand)]'>
              {vm.slot.weekdayName} · {vm.slot.periodText} · {vm.slot.timeText}
            </span>
          </motion.div>
        )}
      </div>
      {expanded && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} className='mt-3.5 flex items-center justify-center gap-3'>
          {[0, 1, 2].map((li) => (
            <motion.span key={li} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: li * 0.12, duration: 0.6, ease: EASE_OUT }} className='chip border-brand/50 text-brand-strong'>{vm.participants[li]}</motion.span>
          ))}
          <span className='text-[15px] text-brand-strong'>→ 共同空闲</span>
        </motion.div>
      )}
    </div>
  );
}

/** 空间收敛：63 → ≥120座7 → A1-201 拉前（Surface 2 hero focus） */
function RoomResolver({ rooms, recommend }: { rooms: boolean; recommend: boolean }): JSX.Element {
  return (
    <div className='flex min-h-0 min-w-0 flex-col gap-4'>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={rooms ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.8, ease: EASE_OUT }} className='panel-raised material-topline flex items-center justify-around px-6 py-4'>
        <div className='text-center'>
          <KineticMetric to={vm.funnel.allRoomsAvailable} settle={rooms} className='t-metric text-ink' />
          <p className='t-caption mt-0.5'>{C.collaboration.funnelAll}</p>
        </div>
        <ArrowRight size={28} className='text-mute' />
        <div className='text-center'>
          <KineticMetric to={vm.funnel.capacity120Plus} settle={rooms} className='t-metric text-stream' />
          <p className='t-caption mt-0.5'>{C.collaboration.funnelCap}</p>
        </div>
      </motion.div>

      {/* 候选 chips（≥120 座） */}
      <motion.div initial={{ opacity: 0 }} animate={rooms ? { opacity: 1 } : {}} className='flex flex-wrap gap-2 px-1'>
        {vm.candidatesCap120.map((r) => (
          <span key={r.name} className={'chip text-[13px] ' + (r.name === vm.recommended.name ? 'border-[color-mix(in_srgb,var(--brand)_55%,transparent)] text-brand' : '')}>
            {r.name} · {r.capacity}座
          </span>
        ))}
      </motion.div>

      {/* 推荐主卡：Camera 拉前（唯一 Surface 2） */}
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={recommend ? { opacity: 1, y: 0, scale: 1 } : {}}
        transition={{ duration: 0.9, ease: EASE_OUT }}
        className='plane-hero depth-shift-near flex flex-1 flex-col justify-center gap-3 px-8 py-6'
        style={{ boxShadow: recommend ? 'var(--shadow-glow-brand)' : 'var(--shadow-panel)' }}
      >
        <p className='t-caption'>推荐空间 · rank 1</p>
        <motion.p className='t-metric-lg' style={{ color: 'var(--brand-strong)' }} initial={{ opacity: 0 }} animate={recommend ? { opacity: 1 } : {}}>{vm.recommended.name}</motion.p>
        <div className='flex flex-wrap gap-2'>
          <Badge tone='brand'>{vm.recommended.campusName}</Badge>
          <Badge>{vm.recommended.building}</Badge>
          <Badge>{vm.recommended.type} · {vm.recommended.capacity} 座</Badge>
        </div>
      </motion.div>
    </div>
  );
}

/** HeroCollaboration —— 视觉隐喻：三人的时间交集，落成真实空间方案。
 *  事实：教师005/006/014 第1周唯一共同空闲=周四第1-4节；63间可用→≥120座7间→推荐 A1-201(120)。
 *  Phase 2.6：单一 Primary Focus —— recommend 之后左侧时间矩阵自动降调，A1-201 独占舞台。 */
export function HeroCollaboration(): JSX.Element {
  const t = useHeroClock('hero-collaboration');
  const busy = reached(t, at('collab.busy'));
  const intersection = reached(t, at('collab.intersection'));
  const expanded = reached(t, at('collab.expand'));
  const rooms = reached(t, at('collab.rooms'));
  const recommend = reached(t, at('collab.recommend'));
  const verdict = reached(t, at('collab.verdict'));

  return (
    <div className='stage-safe flex flex-col gap-4'>
      <SceneHeader
        size='headline'
        kicker={C.collaboration.kicker}
        headline={C.collaboration.headline}
        sub={C.collaboration.sub}
        badge={<Badge tone='brand' icon={<Users size={15} />}>协同规划</Badge>}
      />

      <div className='grid min-h-0 flex-1 min-w-0 grid-cols-[1.08fr_1fr] gap-7'>
        <motion.div
          className='plane material-topline flex min-h-0 min-w-0 flex-col p-5'
          animate={{ opacity: recommend ? 0.78 : 1, filter: recommend ? 'saturate(0.82)' : 'saturate(1)' }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        >
          <p className='t-caption mb-2.5'>{C.collaboration.lanesLabel}</p>
          <LaneScanner showBusy={busy} intersection={intersection} expanded={expanded} />
        </motion.div>
        <RoomResolver rooms={rooms} recommend={recommend} />
      </div>

      <BlurIn delay={verdict ? 0.2 : 6} className="flex items-center justify-between gap-6">
        <p className='t-body text-mute'>{C.collaboration.verdict}</p>
        <VerifiedSourcePill />
      </BlurIn>
    </div>
  );
}
