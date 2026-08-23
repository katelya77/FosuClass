import { useDirectorStore } from '../../stores/directorStore';

  /** 数据模式徽标：fixture 与 live 绝不允许混淆。极低调，仅一枚 chip。 */
export function RecordHUD(): JSX.Element {
  const dataMode = useDirectorStore((s) => s.dataMode);
  const fixture = dataMode === 'fixture';
  return (
    <div className='absolute bottom-3 left-[var(--safe-x)] z-30 flex items-center'>
      <span
        className='chip border-line-strong bg-canvas-deep/70'
        role='status'
      >
        <span
        className='inline-block size-1.5 rounded-full'
        style={{ background: fixture ? 'var(--risk)' : 'var(--success)' }}
        />
        {fixture ? '占位示意数据 · 非真实运行结果' : '腾讯云 ADP 实时运行'}
      </span>
    </div>
  );
}