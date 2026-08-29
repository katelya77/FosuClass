import { motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { BrandLockup } from '../components/visual/BrandLockup';
import { CampusTemporalGraph } from '../components/visual/CampusTemporalGraph';
import { BlurIn, RiseIn } from '../components/visual/TextFx';
import { EASE_OUT } from '../motion/motionTokens';

const STABLE = { nodes: 0, connections: 0, focus: 0, brand: 0 };

/** Closings —— 呼应 Opening 的时空场，但这一次关系已稳定、有序、安静。
 *  段落：时空场重新显影（稳定态） → 品牌落版 → 一句收束 → 网络静息。 */
export function ClosingScene(): JSX.Element {
  return (
    <div className="stage-safe flex flex-col items-center justify-center gap-8">
      {/* 稳定时空场背景：低存在感，安静呼吸 */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.13]"
        initial={{ opacity: 0 }} animate={{ opacity: 0.13 }} transition={{ duration: 2.2, ease: EASE_OUT }}
      >
        <CampusTemporalGraph beats={STABLE} local={10} />
      </motion.div>
      {/* 中央净空：让品牌始终处于无干扰的视觉中心（节点/连线不再与标题打架） */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(46% 42% at 50% 50%, rgba(255,250,246,0.98), rgba(255,246,241,0.72) 54%, transparent 78%)" }} />

      <div className="relative flex flex-col items-center gap-7 text-center">
        <BrandLockup align="center" delay={0.7} />
        <BlurIn delay={1.6}>
          <p className="t-section font-normal tracking-wide text-mute">让教学时空，被理解、被安排。</p>
        </BlurIn>
        <RiseIn delay={2.3} className="flex items-center gap-3">
          <span className="chip">Multi-Agent</span>
          <span className="chip">CampusTools</span>
          <span className="chip"><span className="inline-block size-1.5 rounded-full bg-[var(--success)]" />Verified</span>
        </RiseIn>
        <RiseIn delay={3.1} className="closing-handoff">
          <span>下一幕 · Judge Portal</span>
          <strong>打开评审体验站，问问小序</strong>
          <ArrowUpRight size={20} />
        </RiseIn>
      </div>
    </div>
  );
}
