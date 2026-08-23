import { useDirectorStore } from '../../stores/directorStore';

/** 数据模式徽标：fixture 与 live 绝不允许混淆。极低调，仅一枚 chip，右下角。 */
export function RecordHUD(): JSX.Element {
  const dataMode = useDirectorStore((s) => s.dataMode);
  const fixture = dataMode === 'fixture';
  return (
    <div className='absolute bottom-3 right-[var(--safe-x)] z-30 flex items-center'>
      <span className='chip border-line-strong bg-canvas-deep/70' role='status'>
        <span
          className='inline-block size-1.5 rounded-full'
          style={{ background: fixture ? 'var(--success)' : 'var(--brand-secondary)' }}
        />
        {fixture ? '已核验演示快照 · competition-demo-v3' : '腾讯 ADP · 实时运行'}
      </span>
    </div>
  );
}