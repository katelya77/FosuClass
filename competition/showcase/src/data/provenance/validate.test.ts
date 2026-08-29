import { describe, expect, it } from 'vitest';
import { placeholderFixture, type AnyFixture } from '../types/fixture';
import { ProvenanceError, assertFixtureProvenance, isPlaceholderFixture, isVerifiedFixture } from './validate';

describe('fixture provenance 门禁', () => {
  it('placeholder 必须 verified=false 且通过校验', () => {
    const f = placeholderFixture({ sceneId: 'opening', payload: { a: 1 } });
    expect(f.verified).toBe(false);
    expect(isPlaceholderFixture(f)).toBe(true);
    expect(isVerifiedFixture(f)).toBe(false);
    expect(() => assertFixtureProvenance(f, { sceneId: 'opening' })).not.toThrow();
  });

  it('placeholder 冒充 verified=true 立即抛错', () => {
    const fake = {
      ...placeholderFixture({ sceneId: 'opening', payload: {} }),
      verified: true,
    } as unknown as AnyFixture<Record<string, never>>;
    expect(() => assertFixtureProvenance(fake)).toThrow(ProvenanceError);
  });

  it('golden 必须 verified=true', () => {
    const golden = placeholderFixture({ sceneId: 'risk', payload: {} });
    const badGolden = {
      ...golden,
      source: 'adp-runtime-golden' as const,
    } as unknown as AnyFixture<Record<string, never>>;
    expect(() => assertFixtureProvenance(badGolden)).toThrow(/verified/);
  });

  it('requireVerified 拒绝 placeholder', () => {
    const f = placeholderFixture({ sceneId: 'insight', payload: {} });
    expect(() => assertFixtureProvenance(f, { requireVerified: true })).toThrow(/placeholder/);
  });

  it('sceneId 不匹配抛错', () => {
    const f = placeholderFixture({ sceneId: 'opening', payload: {} });
    expect(() => assertFixtureProvenance(f, { sceneId: 'closing' })).toThrow(/sceneId/);
  });
});