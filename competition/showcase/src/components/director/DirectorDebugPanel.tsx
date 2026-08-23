import { useDirectorStore } from '../../stores/directorStore';
import { SCENES, TOTAL_DURATION } from '../../director/timeline';
import type { SceneId } from '../../director/types';

const RATES = [0.5, 1, 1.5];

/** 导演调试面板 —— 仅开发模式渲染；mode=record 时完全不存在于 DOM */
export function DirectorDebugPanel(): JSX.Element {
  const s = useDirectorStore();
  return (
    <footer
      data-testid='debug-panel'
      className='absolute inset-x-[var(--safe-x)] bottom-4 z-40 flex items-center gap-2 rounded-xl border border-line bg-canvas-deep/85 px-3 py-2 backdrop-blur-sm'
    >
      <button className='ctrl-btn' onClick={s.toggle} aria-label={s.playing ? '暂停' : '播放'}>
        {s.playing ? '暂停' : '播放'}
      </button>
      <button className='ctrl-btn' onClick={s.restart}>重播</button>
      <button className='ctrl-btn' onClick={s.prevScene} aria-label='上一场景'>上一场</button>
      <button className='ctrl-btn' onClick={s.nextScene} aria-label='下一场景'>下一场</button>

      <select
        className='ctrl-btn w-44 appearance-none pl-3 pr-8'
        value={s.currentScene}
        onChange={(e) => s.goToScene(e.target.value as SceneId, { play: s.playing })}
        aria-label='跳转场景'
      >
        {SCENES.map((sc) => (
          <option key={sc.id} value={sc.id}>
            {sc.label}
          </option>
        ))}
      </select>

      <input
        type='range'
        min={0}
        max={TOTAL_DURATION}
        step={0.1}
        value={Math.min(s.elapsed, TOTAL_DURATION)}
        onChange={(e) => s.seek(Number(e.target.value))}
        aria-label='时间轴'
        className='h-11 min-w-0 flex-1 accent-[var(--brand)]'
      />
      <span className='t-caption w-24 tabular-nums text-right'>
        {s.elapsed.toFixed(1)}s / {TOTAL_DURATION}s
      </span>

      <div className='flex items-center gap-1'>
        {RATES.map((r) => (
          <button key={r} className='ctrl-btn px-3' data-active={s.playbackRate === r} onClick={() => s.setRate(r)}>
            {r}×
          </button>
        ))}
      </div>
      <button className='ctrl-btn' data-active={s.guidesVisible} onClick={s.toggleGuides} aria-pressed={s.guidesVisible}>
        参考线
      </button>
      <button className='ctrl-btn' data-active={s.recordPreview} onClick={s.toggleRecordPreview} aria-pressed={s.recordPreview}>
        录制预览
      </button>
    </footer>
  );
}