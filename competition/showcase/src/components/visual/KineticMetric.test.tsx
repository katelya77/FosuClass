import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { KineticMetric } from './KineticMetric';

function stubReduced(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({ matches, media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }),
  });
}

afterEach(() => cleanup());

describe('KineticMetric（确定性指标动画，修复 CountUp 中间态）', () => {
  it('settle=false 时显示扫描态（绝不显示稳定业务值）', () => {
    stubReduced(true);
    const { container } = render(<KineticMetric to={63} settle={false} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(container.querySelector('.kinetic-num')?.className).toContain('kinetic-scan');
  });

  it('settle=true 且 reduced-motion 时直接显示真实终值', () => {
    stubReduced(true);
    render(<KineticMetric to={56} settle={true} />);
    expect(screen.getByText('56')).toBeTruthy();
  });

  it('settle=true 落定后显示单位', () => {
    stubReduced(true);
    render(<KineticMetric to={120} settle={true} unit="座" />);
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('座')).toBeTruthy();
  });

  it('settle=false 时单位不出现（仍在计算）', () => {
    stubReduced(true);
    render(<KineticMetric to={120} settle={false} unit="座" />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('座')).toBeNull();
  });
});
