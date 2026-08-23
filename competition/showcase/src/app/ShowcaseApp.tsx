import { useEffect, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { MotionConfig } from 'motion/react';
import { AmbientBackground } from '../components/visual/AmbientBackground';
import { SceneTransition } from '../components/director/SceneTransition';
import { DirectorDock } from '../components/director/DirectorDock';
import { SceneRail } from '../components/director/SceneRail';
import { RecordHUD } from '../components/director/RecordHUD';
import { parseShowcaseUrl } from '../lib/urlMode';
import { useDirectorEngine, useKeyboardDirectives } from '../director/useDirector';
import { usePointerField } from '../director/usePointerField';
import { useDirectorStore } from '../stores/directorStore';
import { SCENE_KIND } from '../director/transitionMap';
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
 * URL 契约：?mode=record &data=fixture|live &autoplay=1 &scene=… &t=… &quality=… &recordHud=1
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
    s.setQuality(modes.quality);
    s.setRecordHud(modes.recordHud);
    s.setLoop(modes.preview === 'visual');
    if (modes.rate !== undefined) s.setRate(modes.rate);
    if (modes.scene) s.goToScene(modes.scene, { play: false });
    if (modes.t !== undefined) s.seek(modes.t);
    if (modes.beat) s.seekToBeat(modes.beat);
    if (modes.autoplay) s.play();
  }, [modes]);

  useDirectorEngine();
  useKeyboardDirectives(modes.mode);
  // Director 交互层：指针光场只在 dev/preview 启用；Record Mode 零监听（录屏不依赖鼠标）
  usePointerField(modes.mode !== 'record');

  const scene = useDirectorStore((s) => s.currentScene);
  const guidesVisible = useDirectorStore((s) => s.guidesVisible);
  const recordPreview = useDirectorStore((s) => s.recordPreview);
  // 录制模式（或开发态的录制预览）隐藏一切开发控制
  const cleanStage = modes.mode === 'record' || recordPreview;

  return (
    <MotionConfig reducedMotion='user'>
      <main className='stage' data-mode={cleanStage ? 'record' : 'dev'} data-data={modes.data}>
        <AmbientBackground />

        {/* Director Stage：场景镜头转场；Record Mode 下内容层带 focus breathing（环境生命感） */}
        <div className='absolute inset-0 z-10'>
          <AnimatePresence initial={false} mode="popLayout">
            <SceneTransition key={scene} kind={SCENE_KIND[scene]}>
              <div className='breathe-in-record h-full w-full'>
                <ActiveScene scene={scene} recordMode={cleanStage} />
              </div>
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

        {!cleanStage && <SceneRail />}
        <RecordHUD />
        {!cleanStage && <DirectorDock />}
      </main>
    </MotionConfig>
  );
}
