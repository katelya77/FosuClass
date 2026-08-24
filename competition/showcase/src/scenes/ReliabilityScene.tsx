import { motion } from 'motion/react';
import { FileCheck2, Network, UserRound, Wrench } from 'lucide-react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { AdpLiveFrame } from '../components/adp/AdpLiveFrame';
import { LiveDemoCue } from '../components/adp/LiveDemoCue';
import { useDirectorStore } from '../stores/directorStore';
import { getSceneStart } from '../director/timeline';
import { EASE_OUT } from '../motion/motionTokens';
import { LIVE_DEMO_PROMPTS } from '../live-demo/prompts';

const CHAIN = [
  { icon: UserRound, label: "用户意图", sub: "自然语言校园任务", color: "var(--brand-secondary)" },
  { icon: Network, label: "Multi-Agent", sub: "主编排 → 领域智能体", color: "var(--brand)" },
  { icon: Wrench, label: "CampusTools", sub: "13 操作 · 确定性事实源", color: "var(--brand-secondary)" },
  { icon: FileCheck2, label: "Verified Result", sub: "可核查结果 · 回执契约", color: "var(--success)" },
];

function useRelLocal(): number {
  return useDirectorStore((s) => Math.max(0, s.elapsed - getSceneStart("reliability")));
}

/** Reliabitity —— Live Proof Stage：四节点证据链 → Verified Result 扩展成真实 ADP 真机。 */
export function ReliabilityScene(): JSX.Element {
  const t = useRelLocal();
  const showChain = t > 0.3;
  const expand = t > 4.6; // 结果节点扩展成真机
  const chainRevealed = Math.min(CHAIN.length, Math.max(0, Math.floor(t / 1.15) + 1));

  return (
    <div className="stage-safe flex flex-col gap-5">
      <SceneHeader
        kicker="可靠性"
        title="真机证据 · 可核查的运行链路"
        badge={<Badge tone="brand" icon={<Network size={14} />}>Runtime Proof</Badge>}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[0.9fr_1.1fr] gap-7">
        {/* 左：证据链 + 演示 Cue */}
        <div className="flex min-h-0 flex-col gap-5">
          <div className="relative flex min-h-0 flex-1 flex-col justify-center gap-2.5">
            {showChain && (
              <>
                {/* 证据链主脉冲 */}
                <motion.div aria-hidden className="absolute left-[25px] top-4 bottom-4 w-px"
                  initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 3.4, ease: EASE_OUT }}
                  style={{ background: "linear-gradient(180deg, transparent, rgba(124,228,189,0.4), transparent)", transformOrigin: "top" }} />
                {CHAIN.map((c, i) => {
                  const shown = i < chainRevealed;
                  return (
                    <motion.div key={c.label} initial={{ opacity: 0, x: -16 }} animate={shown ? { opacity: 1, x: 0 } : {}} transition={{ delay: i * 1.05, duration: 0.7, ease: EASE_OUT }}
                      className={'relative flex items-center gap-4 rounded-2xl border px-5 py-3 ' + (i === 3 && expand ? 'border-[color-mix(in_srgb,var(--brand)_50%,transparent)] bg-[var(--brand-dim)] shadow-[var(--glow-brand)]' : 'border-line bg-canvas-deep/50')}>
                      <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-raised">
                        <c.icon size={19} color={c.color} />
                        {shown && i === chainRevealed - 1 && (
                          <motion.span className="absolute inset-0 rounded-full border" style={{ borderColor: c.color }} initial={{ opacity: 0.8, scale: 1 }} animate={{ opacity: 0, scale: 1.9 }} transition={{ duration: 1.2, repeat: Infinity }} />
                        )}
                      </span>
                      <div>
                        <p className="t-card-title">{c.label}</p>
                        <p className="t-caption">{c.sub}</p>
                      </div>
                      {i === 3 && expand && (
                        <motion.span className="ml-auto text-[12px] font-medium text-brand-strong" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>→ 展开真机</motion.span>
                      )}
                    </motion.div>
                  );
                })}
              </>
            )}
          </div>
          <div className="panel material-topline p-4">
            <p className="t-caption mb-2">现场 Demo Cue（键盘 1~6 复制任务）</p>
            <LiveDemoCue activeKey={t > 7 ? LIVE_DEMO_PROMPTS[1].key : LIVE_DEMO_PROMPTS[0].key} />
          </div>
        </div>

        {/* 右：真机 ADP Live Frame（blur 只属于展开过渡本身） */}
        <motion.div
          initial={{ opacity: 0, scale: 0.78, filter: "blur(8px)" }}
          animate={expand ? { opacity: 1, scale: 1, filter: "blur(0px)" } : {}}
          transition={{ duration: 1.2, ease: EASE_OUT }}
          className="relative flex min-h-0 flex-col overflow-hidden rounded-3xl"
          style={{ boxShadow: expand ? "var(--shadow-depth)" : undefined }}
        >
          {/* Temporal Frame 顶部 */}
          <div className="flex items-center justify-between gap-4 rounded-t-3xl border-b border-line bg-white/76 px-5 py-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <span className="size-2 shrink-0 rounded-full bg-[var(--success)] animate-pulse" />
              <div className="min-w-0">
                <p className="t-card-title text-[15.5px]">腾讯云智能 ADP · LIVE</p>
                <p className="t-caption">实时运行 · 已核验演示快照 competition-demo-v3</p>
              </div>
            </div>
            <Badge tone="brand">LIVE</Badge>
          </div>
          <AdpLiveFrame className="min-h-0 flex-1 rounded-b-3xl" />
        </motion.div>
      </div>

      <p className="t-caption text-center">跨域安全留白：Showcase 不读取/不写入 ADP iframe 内部，仅负责外部镜头</p>
    </div>
  );
}
