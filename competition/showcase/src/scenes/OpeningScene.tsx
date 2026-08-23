import { AnimatePresence, motion } from "motion/react";
import { useDirectorStore } from "../stores/directorStore";
import { getSceneStart } from "../director/timeline";
import { BrandLockup } from "../components/visual/BrandLockup";
import { CampusTemporalGraph } from "../components/visual/CampusTemporalGraph";

const BEATS = { nodes: 1.2, connections: 4.0, focus: 8.0, brand: 12.0 };

/** 叙事字幕：无旁白也能看懂的画面自解释文案 */
const NARRATION = [
  "一所校园的学期，始于无数分散的要素",
  "课程 · 教师 · 班级 · 教室 · 时间 · 校区",
  "关系逐渐显形",
];

function useOpeningLocal(): number {
  return useDirectorStore((s) => Math.max(0, s.elapsed - getSceneStart("opening")));
}

/**
 * Opening —— Phase 1 视觉验收场景。
 * 0~12s：分散节点 → 连接显形 → 时空聚焦 → 收束到品牌；
 * 12~24s：品牌保持 + 环境呼吸。左图右标，中文第一视觉语言。
 */
export function OpeningScene({ recordMode }: { recordMode: boolean }): JSX.Element {
  const local = useOpeningLocal();
  const narrationIndex =
    local >= BEATS.focus ? 2 : local >= BEATS.connections ? 1 : 0;
  const brandShown = local >= BEATS.brand;

  return (
    <div className="stage-safe flex w-full">
      {/* 左：教学要素关系图 */}
      <div className="relative flex min-w-0 flex-1 flex-col pr-16">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.9 }}
          className="t-caption mb-2"
        >
          校园教学时空
        </motion.p>

        <div className="relative min-h-0 flex-1">
          <CampusTemporalGraph beats={BEATS} />

          {/* 叙事字幕（brand 出现后淡出） */}
          <AnimatePresence mode="wait">
            {!brandShown && (
              <motion.div
                key={narrationIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none absolute right-0 top-2 max-w-[240px] text-right"
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
          style={{
            background: "linear-gradient(180deg, transparent, rgba(70,199,154,0.45), transparent)",
          }}
        />
      </div>

      {/* 右：品牌核心 */}
      <div className="relative flex w-[600px] shrink-0 items-center pl-20">
        <BrandLockup delay={BEATS.brand} />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: BEATS.brand + 1.6, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="absolute bottom-2 left-20 flex items-center gap-3"
        >
          <span className="chip">Multi-Agent</span>
          <span className="chip">CampusTools</span>
          <span className="chip">
            <span className="inline-block size-1.5 rounded-full bg-[var(--success)]" />
            Verified
          </span>
        </motion.div>

        {!recordMode && (
          <span className="t-caption absolute right-0 top-0 opacity-60">Competition Showcase · Phase 1</span>
        )}
      </div>
    </div>
  );
}
