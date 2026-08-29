import { useDirectorStore } from '../../stores/directorStore';

/** RecordHUD —— 数据模式徽标 + 可选录制指示器。
 *  数据模式：fixture 与 live 绝不允许混淆，极低调一枚 chip。
 *  recordHud=1 时才显示 REC / 场景时间；默认完全纯净。 */
export function RecordHUD(): JSX.Element {
  const dataMode = useDirectorStore((s) => s.dataMode);
  const recordHud = useDirectorStore((s) => s.recordHud);
  const currentScene = useDirectorStore((s) => s.currentScene);
  const elapsed = useDirectorStore((s) => s.elapsed);
  const fixture = dataMode === 'fixture';
  return (
    <>
      <div className="absolute bottom-4 right-[var(--safe-x)] z-30 flex items-center">
        <span className="chip border-line-strong bg-canvas-deep/70" role="status">
          <span className="inline-block size-1.5 rounded-full" style={{ background: fixture ? 'var(--success)' : 'var(--brand-secondary)' }} />
          {fixture ? '已核验演示快照 · competition-demo-v3' : '腾讯 ADP · 实时运行'}
        </span>
      </div>
      {recordHud && (
        <div className="absolute left-[var(--safe-x)] top-5 z-30 flex items-center gap-3 panel-glass px-3 py-1.5 rounded-xl">
          <span className="flex items-center gap-1.5 text-[12px] font-medium tracking-widest text-[var(--danger)]">
            <span className="inline-block size-2 rounded-full bg-[var(--danger)] animate-pulse" />
            REC
          </span>
          <span className="t-mono text-[12px] text-mute">{currentScene} · {elapsed.toFixed(1)}s</span>
        </div>
      )}
    </>
  );
}