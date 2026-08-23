import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { LiveDemoCue } from './LiveDemoCue';
import { LIVE_DEMO_PROMPTS } from '../../live-demo/prompts';

afterEach(() => cleanup());

describe('LiveDemoCue（现场操作员提示）', () => {
  it('渲染全部 6 条 Demo Prompt 预设', () => {
    render(<LiveDemoCue />);
    for (const p of LIVE_DEMO_PROMPTS) {
      expect(screen.getByText(p.label)).toBeTruthy();
    }
  });

  it('点击只复制公开任务文本（navigator.clipboard.writeText），绝不写入 iframe', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LiveDemoCue />);
    const btn = screen.getByRole('button', { name: /复制 Demo Prompt：Demo 1 · 风险/ });
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith('查看教师003第1周课表，并检查他的跨校区赶场风险。');
  });

  it('active 项高亮为当前演示', () => {
    render(<LiveDemoCue activeKey="risk" />);
    const btn = screen.getByRole('button', { name: /复制 Demo Prompt：Demo 1 · 风险/ });
    expect(btn.className).toContain('border-[color-mix');
  });
});
