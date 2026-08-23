import { AnimatePresence, motion } from "motion/react";
import { useDirectorStore } from "../stores/directorStore";
import { getSceneStart } from "../director/timeline";
import { BrandLockup } from "../components/visual/BrandLockup";
import { CampusTemporalGraph } from "../components/visual/CampusTemporalGraph";
import { SceneCamera } from "../components/visual/SceneCamera";
import { RiseIn } from "../components/visual/TextFx";
import { EASE_OUT } from "../motion/motionTokens";

const BEATS = { nodes: 1.2, connections: 4.0, focus: 8.0, brand: 12.0 };

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
 * 0~12s：少量要素脉冲 → 单条关系 pulse → 局部网络 → 时空场收束 → camera pull back 品牌显影；
 * 12~24s：品牌保持 + 背景网络降至 20% + 环境呼吸。
 * Phase 2.6 纪律：全场景恒定 sharp（blur 只存在于场景转场本身）。
 */
export function OpeningScene({ recordMode }: { recordMode: boolean }): JSX.Element {
  const local = useOpeningLocal();
  const narrationIndex = local >= BEATS.focus ? 2 : local >= BEATS.connections ? 1 : 0;
  const brandShown = local >= BEATS.brand;
  // camera：focus 后轻微推近，brand 后 pull back——全程无 blur
  const camScale = local >= BEATS.brand ? 0.988 : local >= BEATS.focus ? 1.025 : 1;

  return (
    <div className="stage-safe flex">
      <SceneCamera shot={{ scale: camScale }} className="flex w-full">
        {/* 左：教学时空场 */}
        <div className="relative flex min-w-0 flex-1 flex-col pr-16">
          <RiseIn delay={0.4} className="mb-2">
            <div className="flex items-center gap-3">
              <span className="inline-block h-px w-8 bg-[var(--brand)] opacity-80" />
              <p className="t-eyebrow">校园教学时空</p>
            </div>
          </RiseIn>

          <div className="relative min-h-0 flex-1">
            <CampusTemporalGraph beats={BEATS} />

            <AnimatePresence mode="wait">
              {!brandShown && (
                <motion.div
                  key={narrationIndex}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.7, ease: EASE_OUT }}
                  className="pointer-events-none absolute right-0 top-2 max-w-[340px] text-right"
                >
                  <span className="hairline mb-3 ml-auto block w-16" />
                  <p className="t-body leading-relaxed text-mute">{NARRATION[narrationIndex]}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 中缝连接线：brand 节拍时从图指向品牌侧 */}
        <div className="relative w-px shrink-0">
          <motion.div
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: BEATS.brand - 0.9, duration: 1.4, ease: EASE_OUT }}
            className="absolute inset-y-0 left-0 w-px origin-top"
            style={{ background: "linear-gradient(180deg, transparent, rgba(79,214,166,0.55), transparent)" }}
          />
        </div>

        {/* 右：品牌核心（出现时处于绝对视觉中心：聚光 + sharp + 网络已降至 20%） */}
        <div className="relative flex w-[760px] shrink-0 items-center pl-14">
          {brandShown && (
            <motion.div
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: BEATS.brand + 0.2, duration: 1.6, ease: EASE_OUT }}
              className="pointer-events-none absolute inset-y-0 -inset-x-10"
              style={{ background: "radial-gradient(52% 46% at 46% 46%, rgba(79,214,166,0.13), transparent 72%)" }}
            />
          )}
          <BrandLockup delay={BEATS.brand} />

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: BEATS.brand + 1.6, duration: 0.9, ease: EASE_OUT }}
            className="absolute bottom-2 left-14 flex items-center gap-3"
          >
            <span className="chip">Multi-Agent</span>
            <span className="chip">CampusTools</span>
            <span className="chip"><span className="inline-block size-1.5 rounded-full bg-[var(--success)]" />Verified</span>
          </motion.div>

          {!recordMode && (
            <span className="t-caption absolute right-0 top-0 opacity-70">Competition Showcase · Phase 2.6</span>
          )}
        </div>
      </SceneCamera>
    </div>
  );
}
