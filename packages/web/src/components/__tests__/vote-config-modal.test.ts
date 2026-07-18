import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VoteConfigModal } from '@/components/VoteConfigModal';

Object.assign(globalThis as Record<string, unknown>, { React });

function render(props: Partial<Parameters<typeof VoteConfigModal>[0]> = {}): string {
  const defaults = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };
  return renderToStaticMarkup(React.createElement(VoteConfigModal, { ...defaults, ...props }));
}

describe('VoteConfigModal', () => {
  it('renders modal with question input', () => {
    const html = render();
    expect(html).toContain('发起投票');
    expect(html).toContain('placeholder');
  });

  it('renders option inputs (minimum 2)', () => {
    const html = render();
    // Should have at least 2 option input placeholders
    expect(html).toContain('选项 1');
    expect(html).toContain('选项 2');
  });

  it('renders anonymous toggle', () => {
    const html = render();
    expect(html).toContain('匿名');
  });

  it('renders cancel button', () => {
    const html = render();
    expect(html).toContain('取消');
  });

  it('renders submit button', () => {
    const html = render();
    expect(html).toContain('开始投票');
  });

  it('renders fixed overlay backdrop', () => {
    const html = render();
    expect(html).toContain('fixed');
    expect(html).toContain('inset-0');
    expect(html).toContain('z-50');
  });
});
