import { motion } from 'motion/react';
import { BrandLockup } from '../components/visual/BrandLockup';
import { rise } from '../components/primitives/motion';

/** 收束：品牌落版 + 一句收束语 */
export function ClosingScene(): JSX.Element {
  return (
    <div className='stage-safe flex w-full flex-col items-center justify-center gap-10'>
      <BrandLockup align='center' delay={0.7} />
      <motion.p
        {...rise(1.5, 14)}
        className='t-section font-normal tracking-wide text-mute'
      >
        让教学时空，被理解、被安排。
      </motion.p>
      <motion.div {...rise(2.1, 10)} className='flex items-center gap-3'>
        <span className='chip'>Multi-Agent</span>
        <span className='chip'>CampusTools</span>
        <span className='chip'>
          <span className='inline-block size-1.5 rounded-full bg-[var(--success)]' />
          Verified
        </span>
      </motion.div>
    </div>
  );
}