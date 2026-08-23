import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AdpLiveFrame } from './AdpLiveFrame';
import { DEFAULT_ADP_CHAT_URL, containsCredentialMarker, resolveAdpConfig } from './config';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ADP 配置解析与凭据黑名单', () => {
  it('默认配置指向 ADP 真机地址', () => {
    const cfg = resolveAdpConfig({});
    expect(cfg.chatUrl).toBe(DEFAULT_ADP_CHAT_URL);
    expect(cfg.webimUrl).toContain('/webim/');
  });

  it('VITE_ 环境变量可覆盖', () => {
    const cfg = resolveAdpConfig({ VITE_ADP_EMBED_URL: 'http://example.local/adp' });
    expect(cfg.chatUrl).toBe('http://example.local/adp');
  });

  it('默认配置不含任何凭据标记', () => {
    const cfg = resolveAdpConfig({});
    expect(containsCredentialMarker(cfg.chatUrl)).toBe(false);
    expect(containsCredentialMarker(cfg.webimUrl)).toBe(false);
  });

  it('凭据标记检测器工作正常', () => {
    expect(containsCredentialMarker('x-appkey: deadbeef')).toBe(true);
    expect(containsCredentialMarker('Bearer abc123')).toBe(true);
    expect(containsCredentialMarker('SecretKey=zzz')).toBe(true);
    expect(containsCredentialMarker('https://101.42.184.216/adp-chat-client/')).toBe(false);
  });
});

describe('AdpLiveFrame 状态机', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  });

  it('初始 loading，onLoad 后进入 embedded', () => {
    render(<AdpLiveFrame timeoutMs={100000} />);
    expect(document.querySelector('[data-state=loading]')).not.toBeNull();
    fireEvent.load(screen.getByTitle('腾讯云智能 ADP 真机'));
    expect(document.querySelector('[data-state=embedded]')).not.toBeNull();
  });

  it('超时未加载 → blocked 降级卡片（不绕过安全策略）', () => {
    vi.useFakeTimers();
    render(<AdpLiveFrame timeoutMs={2000} />);
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(document.querySelector('[data-state=blocked]')).not.toBeNull();
    expect(screen.getByText('腾讯 ADP 真机演示')).toBeTruthy();
    const link = screen.getByRole('link', { name: '在新窗口打开腾讯 ADP 真机' });
    expect(link.getAttribute('href')).toBe(DEFAULT_ADP_CHAT_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('forceExternal 完全不渲染 iframe', () => {
    render(<AdpLiveFrame forceExternal />);
    expect(screen.queryByTitle('腾讯云智能 ADP 真机')).toBeNull();
    expect(screen.getByText('外部窗口模式')).toBeTruthy();
  });
});