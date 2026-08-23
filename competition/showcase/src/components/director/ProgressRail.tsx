import { motion } from 'motion/react';
import { SCENES } from '../../director/timeline';
import { useDirectorStore } from '../../stores/directorStore';

/** 右缘场景进度轨（开发模式；点击跳转场景） */
export function ProgressRail(): JSX.Element {
  const current = useDirectorStore((s) => s.currentScene);
  const goToScene = useDirectorStore((s) => s.goToScene);
  const playing = useDirectorStore((s) => s.playing);
  return (
    <nav
      aria-label='场景进度'
      className='absolute right-5 top-1/2 z-40 flex -translate-y-1/2 flex-col items-end gap-4'
    >
      {SCENES.map((sc) => {
        const active = sc.id === current;
        return (
          <button
            key={sc.id}
            onClick={() => goToScene(sc.id, { play: playing })}
            className='group flex items-center gap-3 py-1'
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={
                'text-[12px] tracking-[0.12em] transition-colors duration-300 ' +
                (active ? 'text-ink' : 'text-transparent group-hover:text-mute')
              }
            >
              {sc.label}
            </span>
            {active ? (
              <motion.span layoutId='rail-dot' className='block h-6 w-1 rounded-full bg-brand' />
            ) : (
              <span className='block h-6 w-1 rounded-full bg-line-strong transition-colors group-hover:bg-mute' />
            )}
          </button>
        );
      })}
    </nav>
  );
}