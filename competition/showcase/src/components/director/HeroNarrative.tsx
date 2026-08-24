import { AnimatePresence, motion } from "motion/react";

import { EASE_OUT } from "../../motion/motionTokens";

const PHASES = ["问题", "协作", "核验", "结论"] as const;

interface HeroNarrativeProps {
  t: number;
  question: string;
  conclusion: string;
  verifyAt: number;
  conclusionAt: number;
}

export function HeroNarrative({
  t,
  question,
  conclusion,
  verifyAt,
  conclusionAt,
}: HeroNarrativeProps): JSX.Element {
  const phase = t < 2 ? 0 : t < verifyAt ? 1 : t < conclusionAt ? 2 : 3;

  return (
    <>
      <AnimatePresence>
        {phase === 0 && (
          <motion.div
            className="hero-question-stage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.55, ease: EASE_OUT }}
          >
            <span>问小序</span>
            <h2>{question}</h2>
          </motion.div>
        )}
      </AnimatePresence>

      {phase > 0 && (
        <motion.div
          className="hero-question-chip"
          initial={{ opacity: 0, x: -18, y: 8 }}
          animate={{ opacity: phase === 3 ? 0.38 : 1, x: 0, y: 0 }}
          transition={{ duration: 0.65, ease: EASE_OUT }}
        >
          <span>问题</span>{question}
        </motion.div>
      )}

      <div className="hero-phase-progress" aria-label="场景进度">
        {PHASES.map((label, index) => (
          <span key={label} data-active={index === phase} data-passed={index < phase}>
            {label}
          </span>
        ))}
      </div>

      <AnimatePresence>
        {phase === 3 && (
          <motion.div
            className="hero-conclusion-stage"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE_OUT }}
          >
            <span>结论</span>
            <strong>{conclusion}</strong>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
