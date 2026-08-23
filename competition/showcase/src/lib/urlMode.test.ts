import { describe, expect, it } from 'vitest';
import { parseShowcaseUrl } from './urlMode';

describe('parseShowcaseUrl', () => {
  it('默认：dev + fixture + 不自动播放', () => {
    expect(parseShowcaseUrl('')).toEqual({ mode: 'dev', data: 'fixture', autoplay: false });
  });

  it('record 默认开启 autoplay', () => {
    const m = parseShowcaseUrl('?mode=record&data=fixture');
    expect(m.mode).toBe('record');
    expect(m.autoplay).toBe(true);
  });

  it('autoplay=0 可覆盖 record 默认', () => {
    expect(parseShowcaseUrl('?mode=record&autoplay=0').autoplay).toBe(false);
    expect(parseShowcaseUrl('?mode=record&autoplay=1&data=live').autoplay).toBe(true);
  });

  it('live 数据模式生效', () => {
    expect(parseShowcaseUrl('?data=live').data).toBe('live');
  });

  it('非法 scene / t 回退为 undefined', () => {
    const m = parseShowcaseUrl('?scene=nope&t=abc');
    expect(m.scene).toBeUndefined();
    expect(m.t).toBeUndefined();
  });

  it('合法 scene 与 t 生效（含前导 ?）', () => {
    const m = parseShowcaseUrl('?mode=record&scene=hero-insight&t=12.5');
    expect(m.scene).toBe('hero-insight');
    expect(m.t).toBeCloseTo(12.5);
  });

  it('preview 别名归一化为 record', () => {
    expect(parseShowcaseUrl('?mode=preview').mode).toBe('record');
  });

  it('场景短名别名：risk/collaboration/reschedule/insight', () => {
    expect(parseShowcaseUrl('?scene=risk').scene).toBe('hero-risk');
    expect(parseShowcaseUrl('?scene=collaboration').scene).toBe('hero-collaboration');
    expect(parseShowcaseUrl('?scene=reschedule').scene).toBe('hero-reschedule');
    expect(parseShowcaseUrl('?scene=insight').scene).toBe('hero-insight');
  });

  it('?beat= 参数被保留；空值回退 undefined', () => {
    expect(parseShowcaseUrl('?scene=risk&beat=risk.routes').beat).toBe('risk.routes');
    expect(parseShowcaseUrl('?beat=').beat).toBeUndefined();
  });
});