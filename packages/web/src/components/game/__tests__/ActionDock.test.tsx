import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionDock } from '../ActionDock';

Object.assign(globalThis as Record<string, unknown>, { React });

function render(props: Partial<Parameters<typeof ActionDock>[0]> = {}): string {
  return renderToStaticMarkup(
    React.createElement(ActionDock, {
      onVote: () => {},
      onSpeak: () => {},
      ...props,
    }),
  );
}

describe('ActionDock', () => {
  it('renders vote button', () => {
    const html = render();
    expect(html).toContain('data-testid="vote-btn"');
    expect(html).toContain('投票');
  });

  it('renders input field', () => {
    const html = render();
    expect(html).toContain('data-testid="speak-input"');
    expect(html).toContain('输入发言内容...');
  });

  it('renders send button', () => {
    const html = render();
    expect(html).toContain('data-testid="send-btn"');
    expect(html).toContain('发送');
  });

  it('disables controls when disabled', () => {
    const html = render({ disabled: true });
    expect(html).toContain('disabled');
  });
});
