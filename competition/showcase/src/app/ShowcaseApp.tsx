import { useEffect, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { MotionConfig } from 'motion/react';
import { AmbientBackground } from '../components/visual/AmbientBackground';
import { SceneTransition } from '../components/director/SceneTransition';
import { DirectorDebugPanel } from '../components/director/DirectorDebugPanel';
import { ProgressRail } from '../components/director/ProgressRail';
import { RecordHUD } from '../components/director/RecordHUD';
import { parseShowcaseUrl } from '../lib/urlMode';
import { useDirectorEngine, useKeyboardDirectives } from '../director/useDirector';
import { useDirectorStore } from '../stores/directorStore';
import type { SceneId } from '../director/types';

import { OpeningScene } from '../scenes/OpeningScene';
import { ArchitectureScene } from '../scenes/ArchitectureScene';
import { HeroRisk } from '../scenes/HeroRisk';
import { HeroCollaboration } from '../scenes/HeroCollaboration';
import { HeroReschedule } from '../scenes/HeroReschedule';
import { HeroInsight } from '../scenes/HeroInsight';
import { ReliabilityScene } from '../scenes/ReliabilityScene';
import { ClosingScene } from '../scenes/ClosingScene';

function ActiveScene({ scene, recordMode }: { scene: SceneId; recordMode: boolean }): JSX.Element {
  switch (scene) {
    case 'opening':
      return <OpeningScene recordMode={recordMode} />;
    case 'architecture':
      return <ArchitectureScene />;
    case 'hero-risk':
      return <HeroRisk />;
    case 'hero-collaboration':
      return <HeroCollaboration />;
    case 'hero-reschedule':
      return <HeroReschedule />;
    case 'hero-insight':
      return <HeroInsight />;
    case 'reliability':
      return <ReliabilityScene />;
    case 'closing':
      return <ClosingScene />;
  }
}

export interface ShowcaseAppProps {
  /** 允许测试注入 location.search；默认读真实地址栏 */
  search?: string;
}

/**
 * 单页面电影式 Demo Director：AmbientBackground → DirectorStage → Overlays。
 * URL 契约：?mode=record &data=fixture|live &autoplay=1 &scene=… &t=…
 */
export function ShowcaseApp({ search }: ShowcaseAppProps): JSX.Element {
  const modes = useMemo(
    () => parseShowcaseUrl(search ?? window.location.search),
    [search],
  );

  useEffect(() => {
    const s = useDirectorStore.getState();
    s.setRecordMode(modes.mode === 'record');
    s.setDataMode(modes.data);
    s.setAutoplay(modes.autoplay);
    if (modes.scene) s.goToScene(modes.scene, { play: false });
    if (modes.t !== undefined) s.seek(modes.t);
    // ?beat= 深链：定位到场景级节拍（隐含其所属场景）
    if (modes.beat) s.seekToBeat(modes.beat);
    if (modes.autoplay) s.play();
  }, [modes]);

  useDirectorEngine();
  useKeyboardDirectives(modes.mode);

  const scene = useDirectorStore((s) => s.currentScene);
  const guidesVisible = useDirectorStore((s) => s.guidesVisible);
  const recordPreview = useDirectorStore((s) => s.recordPreview);
  const dataMode = useDirectorStore((s) => s.dataMode);
  // 录制模式（或开发态的录制预览）隐藏一切开发控制
  const cleanStage = modes.mode === 'record' || recordPreview;

  return (
    <MotionConfig reducedMotion='user'>
      <main className='stage' data-mode={cleanStage ? 'record' : 'dev'} data-data={dataMode}>
        <AmbientBackground />

        {/* Director Stage：场景交叉溶解 */}
        <div className='absolute inset-0 z-10'>
          <AnimatePresence initial={false}>
            <SceneTransition key={scene}>
              <ActiveScene scene={scene} recordMode={cleanStage} />
            </SceneTransition>
          </AnimatePresence>
        </div>

        {guidesVisible && !cleanStage && (
          <div className='guide-overlay' aria-hidden>
            <div className='guide-safe-rect' />
            <div className='guide-center-x' />
            <div className='guide-center-y' />
          </div>
        )}

        {!cleanStage && <ProgressRail />}
        <RecordHUD />
        {!cleanStage && <DirectorDebugPanel />}
      </main>
    </MotionConfig>
  );
}