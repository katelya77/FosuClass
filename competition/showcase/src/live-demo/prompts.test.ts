import { describe, expect, it } from 'vitest';
import { LIVE_DEMO_PROMPTS } from './prompts';
import { containsCredentialMarker } from '../components/adp/config';

describe('Live Demo Prompt Presets', () => {
  it('提供 3 组演示主线 + 3 轮连续下钻（共 6 条），且 key 唯一', () => {
    expect(LIVE_DEMO_PROMPTS).toHaveLength(6);
    expect(new Set(LIVE_DEMO_PROMPTS.map((p) => p.key)).size).toBe(6);
  });

  it('覆盖风险 / 协同 / 模拟调课 / 连续下钻四类演示', () => {
    const keys = LIVE_DEMO_PROMPTS.map((p) => p.key);
    expect(keys).toContain('risk');
    expect(keys).toContain('collaboration');
    expect(keys).toContain('reschedule');
    expect(keys).toContain('insight-1');
    expect(keys).toContain('insight-2');
    expect(keys).toContain('insight-3');
  });

  it('每条 prompt 都有明确的"证明点"说明', () => {
    for (const p of LIVE_DEMO_PROMPTS) {
      expect(p.proves.length).toBeGreaterThan(4);
      expect(p.prompt.length).toBeGreaterThan(6);
    }
  });

  it('任何 prompt 不包含凭据 / 密钥标记', () => {
    for (const p of LIVE_DEMO_PROMPTS) {
      expect(containsCredentialMarker(p.prompt)).toBe(false);
    }
  });

  it('Prompts 与任务 §34-§37 文案一致（风险 / 协同 / What-if / 连续下钻）', () => {
    expect(LIVE_DEMO_PROMPTS[0].prompt).toBe('查看教师003第1周课表，并检查他的跨校区赶场风险。');
    expect(LIVE_DEMO_PROMPTS[1].prompt).toContain('教师005、教师006、教师014');
    expect(LIVE_DEMO_PROMPTS[2].prompt).toContain('不指定教室');
    expect(LIVE_DEMO_PROMPTS[3].prompt).toBe('未来四周教师负载最高的是谁？');
  });
});
