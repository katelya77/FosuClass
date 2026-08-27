import { motion } from 'motion/react';
import { ArrowDown, Bot, FileCheck2, Network, UserRound, Wrench } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { useDirectorStore } from '../stores/directorStore';
import { getSceneStart } from '../director/timeline';
import { EASE_OUT } from '../motion/motionTokens';

const CHAIN = [
  { icon: UserRound, label: '用户问题', sub: '一句自然语言校园任务', color: 'var(--brand-secondary)' },
  { icon: Network, label: '主协调', sub: '理解问题并安排协作', color: 'var(--brand)' },
  { icon: Bot, label: '专业 Agent', sub: '按领域完成判断与规划', color: 'var(--brand)' },
  { icon: Wrench, label: 'CampusTools', sub: '调用确定性教学工具', color: 'var(--brand-secondary)' },
  { icon: FileCheck2, label: '已核验结果', sub: '带着可核查依据返回', color: 'var(--success)' },
] as const;

const PROOFS = [
  { name: 'Multi-Agent', value: '4 Agent 协同', color: 'var(--brand)' },
  { name: 'CampusTools', value: '13 项确定性教学工具', color: 'var(--brand-secondary)' },
  { name: 'Verified', value: '结果可核验', color: 'var(--success)' },
] as const;

function useRelLocal(): number {
  return useDirectorStore((state) => Math.max(0, state.elapsed - getSceneStart('reliability')));
}

/** 4173 只解释真实链路；真机画面在下一镜切到 Judge Portal / ADP Console。 */
export function ReliabilityScene(): JSX.Element {
  const t = useRelLocal();
  const revealed = Math.min(CHAIN.length, Math.max(0, Math.floor((t - 0.35) / 1.05) + 1));
  const handoff = t >= 7.2;

  return (
    <div className='stage-safe flex flex-col gap-5'>
      <SceneHeader
        kicker='真实运行链路'
        title='从用户问题，到已核验结果'
        badge={<Badge tone='brand' icon={<Network size={14} />}>Multi-Agent</Badge>}
      />

      <div className='grid min-h-0 flex-1 grid-cols-[1.08fr_0.92fr] gap-10'>
        <section className='reliability-chain plane material-topline flex min-h-0 flex-col justify-center px-7 py-5' aria-label='真实运行链路' data-qa-reliability-chain>
          {CHAIN.map((node, index) => {
            const shown = index < revealed;
            const current = index === revealed - 1;
            const Icon = node.icon;
            return (
              <div key={node.label} className='contents'>
                <motion.div
                  className='reliability-node flex items-center gap-4 rounded-2xl border px-5 py-3'
                  initial={{ opacity: 0, x: -16 }}
                  animate={shown ? { opacity: 1, x: 0 } : { opacity: 0.18, x: 0 }}
                  transition={{ duration: 0.62, ease: EASE_OUT }}
                  style={{
                    borderColor: current ? `color-mix(in srgb, ${node.color} 52%, transparent)` : 'rgba(171,105,91,0.14)',
                    background: current ? `color-mix(in srgb, ${node.color} 10%, rgba(255,255,255,0.66))` : 'rgba(255,255,255,0.48)',
                    boxShadow: current ? 'var(--shadow-raised)' : 'none',
                  }}
                  data-qa-reliability-node
                >
                  <span className='flex size-10 shrink-0 items-center justify-center rounded-full bg-white/75' style={{ color: node.color }}><Icon size={20} /></span>
                  <div className='min-w-0'>
                    <p className='text-[18px] font-bold text-ink'>{node.label}</p>
                    <p className='text-[13px] text-mute'>{node.sub}</p>
                  </div>
                  {shown && <span className='ml-auto text-[13px] font-semibold text-ok'>已到达</span>}
                </motion.div>
                {index < CHAIN.length - 1 && (
                  <motion.div className='flex h-5 items-center pl-10 text-mute' animate={{ opacity: index < revealed - 1 ? 0.8 : 0.2 }}>
                    <ArrowDown size={15} />
                  </motion.div>
                )}
              </div>
            );
          })}
        </section>

        <aside className='flex min-h-0 flex-col justify-center gap-4' aria-label='运行证明' data-qa-reliability-proofs>
          <p className='t-caption mb-1'>评委只需要看懂三件事</p>
          {PROOFS.map((proof, index) => (
            <motion.div
              key={proof.name}
              className='plane flex items-center gap-5 px-6 py-5'
              initial={{ opacity: 0, y: 14 }}
              animate={t >= 1.8 + index * 1.05 ? { opacity: 1, y: 0 } : { opacity: 0.18, y: 0 }}
              transition={{ duration: 0.65, ease: EASE_OUT }}
              data-qa-reliability-proof
            >
              <span className='h-10 w-1 rounded-full' style={{ background: proof.color }} />
              <div>
                <p className='text-[16px] font-bold' style={{ color: proof.color }}>{proof.name}</p>
                <p className='mt-1 text-[19px] font-semibold text-ink'>{proof.value}</p>
              </div>
            </motion.div>
          ))}

          <motion.div
            className='mt-2 rounded-2xl border border-[color-mix(in_srgb,var(--brand)_32%,transparent)] bg-white/58 px-6 py-4 text-center'
            initial={{ opacity: 0, y: 12 }}
            animate={handoff ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.75, ease: EASE_OUT }}
          >
            <p className='text-[17px] font-bold text-brand-strong'>下一镜：真实 ADP 运行</p>
          </motion.div>
        </aside>
      </div>
    </div>
  );
}
