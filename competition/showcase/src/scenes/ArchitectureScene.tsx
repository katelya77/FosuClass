import { motion } from "motion/react";
import { Network } from "lucide-react";

import coordinatorImage from "../../../demo-portal/public/branding/coordinator-agent.png";
import courseImage from "../../../demo-portal/public/branding/course-space-agent.png";
import riskImage from "../../../demo-portal/public/branding/risk-agent.png";
import insightImage from "../../../demo-portal/public/branding/campus-insight-agent.png";
import toolsImage from "../../../demo-portal/public/branding/camptools-plugin.png";
import { Badge } from "../components/primitives/Badge";
import { SceneHeader } from "../components/primitives/SceneHeader";
import { SceneCamera } from "../components/visual/SceneCamera";
import { BlurIn } from "../components/visual/TextFx";
import { getSceneStart } from "../director/timeline";
import { EASE_OUT } from "../motion/motionTokens";
import { useDirectorStore } from "../stores/directorStore";

const AGENTS = [
  { id: "course", label: "课程空间", helper: "课表 · 教室 · 调课", image: courseImage, top: "7%" },
  { id: "risk", label: "风险规划", helper: "冲突 · 赶场 · 约束", image: riskImage, top: "39%" },
  { id: "insight", label: "校园洞察", helper: "负载 · 态势 · 下钻", image: insightImage, top: "71%" },
] as const;

function useArchLocal(): number {
  return useDirectorStore((s) => Math.max(0, s.elapsed - getSceneStart("architecture")));
}

/** Architecture is presented as a collaboration constellation, not a configuration diagram. */
export function ArchitectureScene(): JSX.Element {
  const t = useArchLocal();
  const showPrompt = t > 0.4;
  const showMain = t > 1.1;
  const showAgents = t > 2.2;
  const showTools = t > 4.2;
  const routing = t > 6;
  const activeAgent = Math.floor(Math.max(0, (t - 6) / 2.4)) % AGENTS.length;

  const route = (d: string, delay: number) => (
    <motion.path
      d={d}
      fill="none"
      stroke="rgba(190,78,62,0.32)"
      strokeWidth={2.2}
      strokeLinecap="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ delay, duration: 1.15, ease: "easeInOut" }}
    />
  );

  return (
    <div className="stage-safe flex flex-col gap-5">
      <SceneHeader
        kicker="协作方式"
        title="一句话交给小序，四个角色协作查清"
        badge={<Badge tone="brand" icon={<Network size={14} />}>Coordinated</Badge>}
      />

      <div className="relative min-h-0 flex-1">
        <SceneCamera shot={{ scale: routing ? 1.015 : 1 }} className="h-full">
          <div className="architecture-film h-full">
            <svg viewBox="0 0 1600 640" preserveAspectRatio="none" className="architecture-lines" aria-hidden>
              {showMain && route("M 220 320 C 300 320 350 320 425 320", 0.05)}
              {showAgents && route("M 615 320 C 700 320 735 126 825 126", 0.08)}
              {showAgents && route("M 615 320 C 700 320 745 320 825 320", 0.2)}
              {showAgents && route("M 615 320 C 700 320 735 514 825 514", 0.32)}
              {showTools && route("M 1045 126 C 1150 126 1180 320 1275 320", 0.08)}
              {showTools && route("M 1045 320 L 1275 320", 0.2)}
              {showTools && route("M 1045 514 C 1150 514 1180 320 1275 320", 0.32)}
              {showTools && (
                <motion.path
                  d="M 1410 430 C 1340 590 560 600 520 430"
                  fill="none"
                  stroke="rgba(165,143,192,0.38)"
                  strokeWidth={1.8}
                  strokeDasharray="5 8"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ delay: 0.72, duration: 1.5, ease: "easeInOut" }}
                />
              )}
              {routing && (
                <motion.circle r={6} fill="var(--brand-coral)" filter="drop-shadow(0 0 10px rgba(232,91,69,.55))">
                  <animateMotion dur="2.6s" repeatCount="indefinite" path={[
                    "M 220 320 C 300 320 350 320 425 320 C 700 320 735 126 825 126 C 1150 126 1180 320 1275 320",
                    "M 220 320 C 300 320 350 320 425 320 C 700 320 745 320 825 320 L 1275 320",
                    "M 220 320 C 300 320 350 320 425 320 C 700 320 735 514 825 514 C 1150 514 1180 320 1275 320",
                  ][activeAgent]} />
                </motion.circle>
              )}
            </svg>

            {showPrompt && (
              <motion.div
                initial={{ opacity: 0, x: -22, filter: "blur(8px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.8, ease: EASE_OUT }}
                className="arch-prompt"
              >
                <span>你只要说</span>
                <strong>“帮我把教学安排查清楚”</strong>
              </motion.div>
            )}

            {showMain && (
              <motion.div
                initial={{ opacity: 0, scale: 0.86, filter: "blur(8px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                transition={{ delay: 0.12, duration: 0.9, ease: EASE_OUT }}
                className="arch-node arch-main"
              >
                <span className="arch-image arch-image-main"><img src={coordinatorImage} alt="" /></span>
                <div><strong>小序 · 主协调</strong><span>理解任务，组织协作</span></div>
              </motion.div>
            )}

            {AGENTS.map((agent, index) => showAgents && (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, x: 26, scale: 0.92 }}
                animate={{ opacity: 1, x: 0, scale: routing && activeAgent === index ? 1.055 : 1 }}
                transition={{ delay: index * 0.14, duration: 0.72, ease: EASE_OUT }}
                className="arch-node arch-agent"
                data-active={routing && activeAgent === index}
                style={{ top: agent.top }}
              >
                <span className="arch-image"><img src={agent.image} alt="" /></span>
                <div><strong>{agent.label}</strong><span>{agent.helper}</span></div>
              </motion.div>
            ))}

            {showTools && (
              <motion.div
                initial={{ opacity: 0, x: 28, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ duration: 0.85, ease: EASE_OUT }}
                className="arch-node arch-tools"
              >
                <span className="arch-image arch-image-tools"><img src={toolsImage} alt="" /></span>
                <div><strong>CampusTools</strong><span>查真实数据，核验每个结论</span></div>
                <em>事实不会被生成式模型改写</em>
              </motion.div>
            )}
          </div>
        </SceneCamera>
      </div>

      <BlurIn delay={6.2} className="arch-verdict">
        <span>问题</span><b>→</b><span>分工</span><b>→</b><span>查询</span><b>→</b><span>核验</span><b>→</b><strong>小序给出结论</strong>
      </BlurIn>
    </div>
  );
}
