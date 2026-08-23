import { beforeEach, describe, expect, it } from 'vitest';
import { RISK_BEATS, RISK_DURATION } from './riskTimeline';
import { COLLAB_BEATS, COLLAB_DURATION } from './collaborationTimeline';
import { RESCHEDULE_BEATS, RESCHEDULE_DURATION } from './rescheduleTimeline';
import { INSIGHT_BEATS, INSIGHT_DURATION } from './insightTimeline';
import { HERO_TIMELINES, resolveBeat } from './registry';
import { SCENES, getSceneStart } from '../timeline';
import { useDirectorStore } from '../../stores/directorStore';

const SETS = [RISK_BEATS, COLLAB_BEATS, RESCHEDULE_BEATS, INSIGHT_BEATS];

describe('Hero 场景级 Timeline', () => {
  it('每个场景的节拍严格递增、id 全局唯一且落在时长内', () => {
    const ids = new Set<string>();
    SETS.forEach((beats, i) => {
      const dur = [RISK_DURATION, COLLAB_DURATION, RESCHEDULE_DURATION, INSIGHT_DURATION][i];
      let last = -1;
      for (const b of beats) {
        expect(b.at).toBeGreaterThan(last);
        expect(b.at).toBeLessThan(dur);
        expect(ids.has(b.id)).toBe(false);
        ids.add(b.id);
        last = b.at;
      }
    });
  });

  it('注册表时长与主时间轴 SCENES 表一致（防漂移）', () => {
    for (const [scene, t] of Object.entries(HERO_TIMELINES)) {
      const meta = SCENES.find((s) => s.id === scene);
      expect(meta).toBeTruthy();
      expect(meta!.duration).toBe(t!.duration);
    }
  });

  it('resolveBeat 支持深链并返回正确场景与偏移', () => {
    expect(resolveBeat('risk.routes')).toEqual({ scene: 'hero-risk', at: 11.0 });
    expect(resolveBeat('resched.constraints')!.scene).toBe('hero-reschedule');
    expect(resolveBeat('nope.nope')).toBeNull();
  });
});

describe('seekToBeat 深链跳转', () => {
  beforeEach(() => {
    useDirectorStore.setState({ elapsed: 0, currentScene: 'opening', playing: false });
  });

  it('未知 beat 返回 false 且不动时钟', () => {
    const s = useDirectorStore.getState();
    expect(s.seekToBeat('ghost.beat')).toBe(false);
    expect(useDirectorStore.getState().elapsed).toBe(0);
  });

  it('已知 beat 跳到场景起点+偏移并切换场景', () => {
    const s = useDirectorStore.getState();
    expect(s.seekToBeat('insight.risk')).toBe(true);
    const st = useDirectorStore.getState();
    expect(st.currentScene).toBe('hero-insight');
    const expected = getSceneStart('hero-insight') + 18.0;
    expect(Math.abs(st.elapsed - expected)).toBeLessThan(0.2);
  });
});