import { AnimatePresence, motion } from "motion/react";
import { useDirectorStore } from "../stores/directorStore";
import { getSceneStart } from "../director/timeline";
import { BrandLockup } from "../components/visual/BrandLockup";
import { CampusTemporalGraph } from "../components/visual/CampusTemporalGraph";
import { SceneCamera } from "../components/visual/SceneCamera";
import { RiseIn } from "../components/visual/TextFx";

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
 * Opening —— Phase 2.5 重做：暗场 → 发现 → 连接 → 聚焦 → 品牌。
 * 0~12s：少量要素脉冲 → 时间脉冲传播 → 时空场收束 → camera pull back 品牌显影；
 * 12~24s：品牌保持 + 环境呼吸。
 */
export function OpeningScene({ recordMode }: { recordMode: boolean }): JSX.Element {
  const local = useOpeningLocal();
  const narrationIndex = local >= BEATS.focus ? 2 : local >= BEATS.connections ? 1 : 0;
  const brandShown = local >= BEATS.brand;
  // camera：focus 后开始进入，brand 后轻微 pull back
  const camScale = local >= BEATS.brand ? 0.985 : local >= BEATS.focus ? 1.03 : 1;
  const camBlur = local >= BEATS.focus ? 0 : 2;

  return (
    <div className="stage-safe flex">
      <SceneCamera shot={{ scale: camScale, blur: camBlur }} className="flex w-full">
        {/* 左：教学时空场 */}
        <div className="relative flex min-w-0 flex-1 flex-col pr-16">
          <RiseIn delay={0.4} className="mb-2">
            <div className="flex items-center gap-3">
              <span className="inline-block h-px w-8 bg-[var(--brand)] opacity-70" />
              <p className="t-eyebrow">校园教学时空</p>
            </div>
          </RiseIn>

          <div className="relative min-h-0 flex-1">
            <CampusTemporalGraph beats={BEATS} />

            <AnimatePresence mode="wait">
              {!brandShown && (
                <motion.div
                  key={narrationIndex}
                  initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                  className="pointer-events-none absolute right-0 top-2 max-w-[300px] text-right"
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
            transition={{ delay: BEATS.brand - 0.9, duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-y-0 left-0 w-px origin-top"
            style={{ background: "linear-gradient(180deg, transparent, rgba(69,201,154,0.5), transparent)" }}
          />
        </div>

        {/* 右：品牌核心 */}
        <div className="relative flex w-[760px] shrink-0 items-center pl-14">
          <BrandLockup delay={BEATS.brand} />

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: BEATS.brand + 1.6, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-2 left-14 flex items-center gap-3"
          >
            <span className="chip">Multi-Agent</span>
            <span className="chip">CampusTools</span>
            <span className="chip"><span className="inline-block size-1.5 rounded-full bg-[var(--success)]" />Verified</span>
          </motion.div>

          {!recordMode && (
            <span className="t-caption absolute right-0 top-0 opacity-60">Competition Showcase · Phase 2.5</span>
          )}
        </div>
      </SceneCamera>
    </div>
  );
}