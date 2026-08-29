import { describe, expect, it } from 'vitest';
import {
  OPENING_BEATS,
  PROGRAM_EVENTS,
  SCENES,
  TOTAL_DURATION,
  getSceneAt,
  getSceneMeta,
  getSceneStart,
  nextScene,
  prevScene,
} from './timeline';

describe('director timeline', () => {
  it('opening 节拍按时间升序且包含五个叙事动作', () => {
    const times = OPENING_BEATS.map((b) => b.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const actions = OPENING_BEATS.map((b) => b.action);
    for (const required of ['enter', 'nodes', 'connections', 'focus', 'brand']) {
      expect(actions).toContain(required);
    }
    expect(OPENING_BEATS.every((b) => b.scene === 'opening')).toBe(true);
  });

  it('程序事件表覆盖全部场景且首帧为 0', () => {
    expect(PROGRAM_EVENTS[0]).toMatchObject({ at: 0, action: 'enter' });
    const enterScenes = new Set(
      PROGRAM_EVENTS.filter((e) => e.action === 'enter').map((e) => e.scene),
    );
    expect(enterScenes.size).toBe(SCENES.length);
  });

  it('总时长等于各场景时长之和且完整可播', () => {
    expect(TOTAL_DURATION).toBe(SCENES.reduce((s, x) => s + x.duration, 0));
    expect(TOTAL_DURATION).toBeGreaterThan(60);
  });

  it('getSceneAt 定位与边界收敛', () => {
    expect(getSceneAt(0).scene).toBe('opening');
    expect(getSceneAt(getSceneStart('hero-reschedule') + 0.5).scene).toBe('hero-reschedule');
    expect(getSceneAt(TOTAL_DURATION - 0.01).scene).toBe('closing');
    expect(getSceneAt(-5).local).toBe(0);
  });

  it('场景导航不越界', () => {
    expect(nextScene('opening')).not.toBe('opening');
    expect(nextScene('closing')).toBe('closing');
    expect(prevScene('opening')).toBe('opening');
    expect(prevScene('closing')).not.toBe('closing');
    expect(getSceneMeta('reliability').label.length).toBeGreaterThan(0);
  });
});