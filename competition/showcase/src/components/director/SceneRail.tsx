import { SCENES } from '../../director/timeline';
import { useDirectorStore } from '../../stores/directorStore';
import { cn } from '../../lib/cn';

/**
 * SceneRail —— 右缘场景进度轨（Phase 2.5 重做）。
 * 不再是生硬右列：低存在感的玻璃侧栏，仅在 dev 模式渲染；纯视觉导航，不参与录屏。
 */
export function SceneRail(): JSX.Element {
  const current = useDirectorStore((s) => s.currentScene);
  const goToScene = useDirectorStore((s) => s.goToScene);
  const playing = useDirectorStore((s) => s.playing);
  return (
    <nav
      aria-label="场景进度"
      className="absolute right-[calc(var(--safe-x)*0.55)] top-1/2 z-40 flex -translate-y-1/2 flex-col items-end gap-3.5"
    >
      {SCENES.map((sc) => {
        const active = sc.id === current;
        return (
          <button
            key={sc.id}
            onClick={() => goToScene(sc.id, { play: playing })}
            className="group flex items-center gap-2.5 py-0.5"
            aria-current={active ? 'step' : undefined}
          >
            <span className={cn("text-[12px] tracking-[0.1em] transition-all duration-300", active ? "text-ink" : "text-transparent group-hover:text-mute")}>
              {sc.label}
            </span>
            <span className={cn("block h-6 w-[3px] rounded-full transition-all duration-300", active ? "bg-brand shadow-[var(--glow-brand)]" : "bg-line-strong group-hover:bg-mute")} />
          </button>
        );
      })}
    </nav>
  );
}