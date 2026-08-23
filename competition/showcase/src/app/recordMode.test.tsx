import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ShowcaseApp } from './ShowcaseApp';

function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  stubMatchMedia();
});
afterEach(() => cleanup());

describe('Record Mode（任务 §19 / §26-F）', () => {
  it('mode=record 隐藏全部开发控制', () => {
    render(<ShowcaseApp search='?mode=record&data=fixture&autoplay=0' />);
    expect(screen.queryByTestId('debug-panel')).toBeNull();
    expect(screen.queryByRole('navigation', { name: '场景进度' })).toBeNull();
    expect(screen.queryByRole('button', { name: '参考线' })).toBeNull();
  });

  it('fixture 模式展示已核验快照徽标（Phase 2 口径）', () => {
    render(<ShowcaseApp search='?mode=record&data=fixture&autoplay=0' />);
    expect(screen.getByRole('status').textContent).toContain('已核验演示快照 · competition-demo-v3');
  });

  it('live 模式徽标切换为 ADP 实时', () => {
    render(<ShowcaseApp search='?mode=record&data=live&autoplay=0' />);
    expect(screen.getByRole('status').textContent).toContain('腾讯 ADP · 实时运行');
  });

  it('dev 模式提供调试面板与进度轨', () => {
    render(<ShowcaseApp search='' />);
    expect(screen.getByTestId('debug-panel')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '场景进度' })).toBeTruthy();
  });

  it('scene 参数直接跳转指定场景（hero-insight 标题可见）', () => {
    render(<ShowcaseApp search='?autoplay=0&scene=hero-insight' />);
    expect(screen.getByText('从全局负载排名，下钻到真实风险')).toBeTruthy();
  });

  it('?beat= 深链定位到节拍时刻（resched.decision 判定横幅可见）', () => {
    render(<ShowcaseApp search='?autoplay=0&beat=resched.decision' />);
    expect(screen.getByText('可行 · 附带提示')).toBeTruthy();
  });
});