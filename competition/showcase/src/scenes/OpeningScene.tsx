import { AnimatePresence, motion } from "motion/react";
import { useDirectorStore } from "../stores/directorStore";
import { getSceneStart } from "../director/timeline";
import { BrandLockup } from "../components/visual/BrandLockup";
import { CampusTemporalGraph } from "../components/visual/CampusTemporalGraph";
import { SceneCamera } from "../components/visual/SceneCamera";
import { RiseIn } from "../components/visual/TextFx";
import { EASE_OUT } from "../motion/motionTokens";

const BEATS = { nodes: 0.8, connections: 2.2, focus: 4.2, brand: 6.4 };

/** 叙事字幕：无旁白也能看懂的画面自解释文案（Phase 2.5 三步显影） */
const NARRATION = [
  "一所校园的学期，始于无数分散的教学时空。",
  "当这些时间、空间与关系被连接——",
  "教学运行，开始可以被理解。",
];

function useOpeningLocal(): number {
  return useDirectorStore((s) => Math.max(0, s.elapsed - getSceneStart("opening")));
}

/**
 * Opening —— Phase 2.6 质感重做：暗场 → 发现 → 连接 → 聚焦 → 品牌。
 * 0~6.4s：少量要素脉冲 → 单条关系 pulse → 局部网络 → 时空场收束 → 品牌显影；
 * 6.4~10s：品牌保持 + 背景网络降至 20% + 环境呼吸。
 * Phase 2.6 纪律：全场景恒定 sharp（blur 只存在于场景转场本身）。
 */
export function OpeningScene({ recordMode }: { recordMode: boolean }): JSX.Element {
  const local = useOpeningLocal();
  const narrationIndex = local >= BEATS.focus ? 2 : local >= BEATS.connections ? 1 : 0;
  const brandShown = local >= BEATS.brand;
  // camera：focus 后轻微推近，brand 后 pull back——全程无 blur
  const camScale = local >= BEATS.brand ? 0.985 : local >= BEATS.focus ? 1.03 : 1;

  return (
    <div className="stage-safe flex">
      <SceneCamera shot={{ scale: camScale }} className="relative h-full w-full">
        {/* 教学时空场：占满整个画面，brand 时向中心收拢并降低到 20% */}
        <div className="absolute inset-0">
          <CampusTemporalGraph beats={BEATS} dimAtBrand={brandShown} />
        </div>

        {/* 顶部眉标 + 左侧叙事字幕（brand 出现前） */}
        <RiseIn delay={0.4} className="absolute left-0 top-0">
          <div className="mb-2 flex items-center gap-3">
            <span className="inline-block h-px w-8 bg-[var(--brand)] opacity-90" />
            <p className="t-eyebrow">校园教学时空</p>
          </div>
        </RiseIn>
        <AnimatePresence mode="wait">
          {!brandShown && (
            <motion.div
              key={narrationIndex}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.7, ease: EASE_OUT }}
              className="pointer-events-none absolute bottom-10 left-0 max-w-[500px]"
            >
              <span className="hairline mb-3 block w-20" />
              <p className="t-body leading-relaxed text-mute">{NARRATION[narrationIndex]}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 品牌核心：绝对视觉中心（sharp + 网络已降至 20%） */}
        {brandShown && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 1.3, ease: EASE_OUT }}
            className="pointer-events-none absolute inset-0 z-20"
          >
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 1.6, ease: EASE_OUT }}
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(40% 36% at 50% 47%, rgba(255,250,246,0.98), rgba(255,246,241,0.72) 52%, transparent 74%), " +
                "radial-gradient(52% 48% at 50% 47%, rgba(232,91,69,0.15), transparent 72%)",
            }}
          />
            <div className="absolute inset-0 flex items-center justify-center">
              <BrandLockup delay={0} align="center" className="-translate-y-2 scale-[1.04]" />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.6, duration: 0.9, ease: EASE_OUT }}
              className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-3"
            >
              <span className="chip">Multi-Agent</span>
              <span className="chip">CampusTools</span>
              <span className="chip"><span className="inline-block size-1.5 rounded-full bg-[var(--success)]" />Verified</span>
            </motion.div>
          </motion.div>
        )}

        {!recordMode && (
          <span className="t-caption absolute right-0 top-0 opacity-70">Competition Showcase · Phase 2.8</span>
        )}
      </SceneCamera>
    </div>
  );
}
