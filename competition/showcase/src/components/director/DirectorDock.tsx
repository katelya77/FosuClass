import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useDirectorStore } from '../../stores/directorStore';
import { SCENES, TOTAL_DURATION } from '../../director/timeline';
import type { SceneId } from '../../director/types';
import { cn } from '../../lib/cn';
import { DUR, EASE_OUT } from '../../motion/motionTokens';

const RATES = [0.5, 1, 1.5];

/**
 * DirectorDock —— 导演玻璃悬浮坞（Phase 2.5 重做）。
 * 仅开发模式渲染；idle 2s 后降 opacity，指针靠近恢复；不干扰最终画面。
 */
export function DirectorDock(): JSX.Element {
  const s = useDirectorStore();
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);

  const poke = () => {
    setIdle(false);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2000);
  };

  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setIdle(true), 2000);
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  useEffect(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
  }, [s.elapsed]);

  return (
    <motion.footer
      data-testid="debug-panel"
      onPointerMove={poke}
      onPointerEnter={poke}
      aria-label="导演控制台"
      animate={{ opacity: idle ? 0.34 : 1 }}
      transition={{ duration: DUR.fast / 1000, ease: EASE_OUT }}
      className={cn(
        "absolute inset-x-[var(--safe-x)] bottom-5 z-40 flex items-center gap-2 px-3.5 py-2.5",
        "panel-glass material-topline rounded-2xl",
      )}
    >
      <div className="flex items-center gap-2">
        <button className="ctrl-btn" onClick={s.toggle} aria-label={s.playing ? '暂停' : '播放'}>
          {s.playing ? '暂停' : '播放'}
        </button>
        <button className="ctrl-btn" onClick={s.restart} aria-label="重播">重播</button>
        <button className="ctrl-btn" onClick={s.prevScene} aria-label="上一场景">上一场</button>
        <button className="ctrl-btn" onClick={s.nextScene} aria-label="下一场景">下一场</button>
      </div>

      <select
        className="ctrl-btn w-40 appearance-none pl-3 pr-7"
        value={s.currentScene}
        onChange={(e) => s.goToScene(e.target.value as SceneId, { play: s.playing })}
        aria-label="跳转场景"
      >
        {SCENES.map((sc) => (
          <option key={sc.id} value={sc.id}>{sc.label}</option>
        ))}
      </select>

      <input
        type="range"
        min={0}
        max={TOTAL_DURATION}
        step={0.1}
        value={Math.min(s.elapsed, TOTAL_DURATION)}
        onChange={(e) => s.seek(Number(e.target.value))}
        aria-label="时间轴"
        className="h-10 min-w-0 flex-1 accent-[var(--brand)]"
      />
      <span className="t-mono w-24 text-right text-[12.5px] text-mute">
        {s.elapsed.toFixed(1)}s
      </span>

      <div className="flex items-center gap-1">
        {RATES.map((r) => (
          <button key={r} className="ctrl-btn px-3" data-active={s.playbackRate === r} onClick={() => s.setRate(r)}>
            {r}×
          </button>
        ))}
      </div>
      <button className="ctrl-btn" data-active={s.guidesVisible} onClick={s.toggleGuides} aria-pressed={s.guidesVisible}>
        参考线
      </button>
      <button className="ctrl-btn" data-active={s.recordPreview} onClick={s.toggleRecordPreview} aria-pressed={s.recordPreview}>
        录制预览
      </button>
    </motion.footer>
  );
}
