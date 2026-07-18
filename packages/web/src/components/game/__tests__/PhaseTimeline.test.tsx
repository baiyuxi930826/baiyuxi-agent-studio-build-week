import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type PhaseEntry, PhaseTimeline } from '../PhaseTimeline';

Object.assign(globalThis as Record<string, unknown>, { React });

const phases: PhaseEntry[] = [
  { name: 'night_action', label: '第一夜', round: 1 },
  { name: 'day_discuss', label: '第一天', round: 1 },
  { name: 'night_action', label: '第二夜', round: 2 },
  { name: 'day_discuss', label: '第二天', round: 2 },
];

function render(currentIndex: number): string {
  return renderToStaticMarkup(React.createElement(PhaseTimeline, { phases, currentIndex }));
}

describe('PhaseTimeline', () => {
  it('renders all phase labels', () => {
    const html = render(3);
    expect(html).toContain('第一夜');
    expect(html).toContain('第一天');
    expect(html).toContain('第二夜');
    expect(html).toContain('第二天');
  });

  it('marks current phase as active', () => {
    const html = render(3);
    // The active phase should have data-active="true" near "第二天"
    expect(html).toContain('data-active="true"');
    // Extract the active element's content
    const activeMatch = html.match(/data-active="true"[^>]*>([^<]+)/);
    expect(activeMatch?.[1]).toBe('第二天');
  });

  it('marks past phases as inactive', () => {
    const html = render(3);
    // "第一夜" should have data-active="false"
    const segments = html.split('data-active=');
    const falseSegments = segments.filter((s) => s.startsWith('"false"'));
    expect(falseSegments.length).toBe(3); // 3 inactive phases
  });

  it('renders arrows between phases', () => {
    const html = render(3);
    const arrowCount = (html.match(/→/g) ?? []).length;
    expect(arrowCount).toBe(3);
  });
});
