import { describe, expect, it } from 'vitest';
import riskFixture from './risk.json';
import collaborationFixture from './collaboration.json';
import rescheduleFixture from './reschedule.json';
import insightFixture from './insight.json';

/** 数据纪律：四个 Hero fixture 必须全部是已核验 golden 快照（禁止 masquerade） */
describe('Hero fixtures 溯源契约', () => {
  const all = [
    ['risk', riskFixture],
    ['collaboration', collaborationFixture],
    ['reschedule', rescheduleFixture],
    ['insight', insightFixture],
  ] as const;

  it.each(all)('%s：golden 来源 + v3 数据版本 + verified', (_name, f) => {
    expect(f.source).toBe('adp-runtime-golden');
    expect(f.dataVersion).toBe('competition-demo-v3');
    expect(f.verified).toBe(true);
    expect(f.fixtureVersion).toBe('2.0.0');
    expect(f.capturedAt.length).toBeGreaterThan(0);
  });

  it.each(all)('%s：sceneId 与目录一致且携带可复现溯源说明', (_name, f) => {
    expect(f.sceneId).toBe('hero-' + _name);
    // 溯源说明必须携带确定性调用与 queryId 标记（工具名不限：query_* / check_* / find_* 等）
    expect(f.provenanceNote).toContain('#q-');
    expect(f.provenanceNote.length).toBeGreaterThan(60);
  });
});