import { FileCheck2, Network, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { Panel } from '../components/primitives/Panel';
import { rise } from '../components/primitives/motion';
import { AdpLiveFrame } from '../components/adp/AdpLiveFrame';

/** 三大可靠性支柱（全部为已交付 Runtime 事实，非愿景） */
export function ReliabilityScene(): JSX.Element {
  const pillars = [
    {
      icon: Network,
      title: 'Multi-Agent 真实调度',
      lines: ['4 Agent · 14 绑定（SSOT）', 'Main → Child → Main', 'Main 不直接调用工具'],
      delay: 0.6,
    },
    {
      icon: Wrench,
      title: 'CampusTools 真实调用',
      lines: ['13 操作 · 参数契约 fail-closed', '确定性事实源 · 模型不得改写', 'Evidence 随结果返回'],
      delay: 0.95,
    },
    {
      icon: FileCheck2,
      title: '可核查的结果与回执',
      lines: ['统一结果卡 campus-result-unified-v1', 'verified 标记贯穿输出', '决策回执 PublicDecisionReceipt 契约'],
      delay: 1.3,
    },
  ];

  return (
    <div className='stage-safe flex w-full flex-col gap-7'>
      <SceneHeader
        kicker='可靠性'
        title='真机证据 · 可核查的运行链路'
        badge={<Badge tone='brand' icon={<Network size={14} />}>Runtime Proof</Badge>}
      />
      <div className='grid min-h-0 flex-1 grid-cols-[1fr_560px] gap-6'>
        <div className='flex min-h-0 flex-col justify-center gap-5'>
          {pillars.map(({ icon: Icon, title, lines, delay }) => (
            <motion.div key={title} {...rise(delay)}>
              <Panel>
                <div className='flex items-start gap-4 py-1'>
                  <span className='flex size-12 shrink-0 items-center justify-center rounded-full border border-line bg-raised'>
                    <Icon size={20} className='text-brand' />
                  </span>
                  <div>
                    <p className='t-card-title'>{title}</p>
                    <ul className='t-caption mt-1.5 space-y-1'>
                      {lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Panel>
            </motion.div>
          ))}
        </div>
        <motion.div {...rise(1.0)} className='flex min-h-0 flex-col gap-3'>
          <AdpLiveFrame className='min-h-0 flex-1' />
          <p className='t-caption text-center'>录制时由 OBS「窗口捕获」采集真实 ADP 窗口</p>
        </motion.div>
      </div>
    </div>
  );
}