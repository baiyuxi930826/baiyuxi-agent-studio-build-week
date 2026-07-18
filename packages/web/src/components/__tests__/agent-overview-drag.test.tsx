/**
 * F166 Task 5: AgentOverviewTab drag-to-reorder integration test.
 * Drops agent B onto agent A → saveAgentOrder is called with new order.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const saveAgentOrderMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/hooks/useAgentData', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAgentData')>('@/hooks/useAgentData');
  return { ...actual, saveAgentOrder: saveAgentOrderMock };
});

vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: false }),
}));

const { AgentOverviewTab } = await import('../config-viewer-tabs');

function minimalAgent(id: string, sessionChain?: boolean): import('@/hooks/useAgentData').AgentData {
  return {
    id,
    displayName: id.toUpperCase(),
    color: { primary: '#000', secondary: '#fff' },
    mentionPatterns: [`@${id}`],
    clientId: 'anthropic',
    defaultModel: 'model',
    avatar: '',
    roleDescription: '',
    personality: '',
    ...(sessionChain !== undefined ? { sessionChain } : {}),
  } as import('@/hooks/useAgentData').AgentData;
}

function makeDragEvent(type: string, dataTransfer: Partial<DataTransfer>): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});
beforeEach(() => {
  saveAgentOrderMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AgentOverviewTab drag & drop (F166)', () => {
  it('shows Session Chain status on member overview cards', async () => {
    const agents = [minimalAgent('A', true), minimalAgent('B', false)];
    const config = { coCreator: null, agents: {} } as unknown as import('../config-viewer-types').ConfigData;

    await act(async () => {
      root.render(React.createElement(AgentOverviewTab, { config, agents }));
    });

    expect(container.querySelector('[data-testid="agent-card-A"]')?.textContent).toContain('Session Chain 已开启');
    expect(container.querySelector('[data-testid="agent-card-B"]')?.textContent).toContain('Session Chain 未开启');
  });

  it('rolls back local order and shows error when saveAgentOrder rejects', async () => {
    saveAgentOrderMock.mockRejectedValueOnce(new Error('boom'));
    const agents = [minimalAgent('A'), minimalAgent('B'), minimalAgent('C')];
    const config = { coCreator: null, agents: {} } as unknown as import('../config-viewer-types').ConfigData;

    await act(async () => {
      root.render(React.createElement(AgentOverviewTab, { config, agents }));
    });

    const cardA = container.querySelector('[data-testid="agent-card-A"]') as HTMLElement;
    const cardB = container.querySelector('[data-testid="agent-card-B"]') as HTMLElement;
    const store = { 'text/plain': '' };
    const dataTransfer = {
      setData: (type: string, value: string) => {
        store[type as 'text/plain'] = value;
      },
      getData: (type: string) => store[type as 'text/plain'] ?? '',
    } as unknown as DataTransfer;

    await act(async () => {
      cardB.dispatchEvent(makeDragEvent('dragstart', dataTransfer));
      cardA.dispatchEvent(makeDragEvent('dragover', dataTransfer));
      cardA.dispatchEvent(makeDragEvent('drop', dataTransfer));
    });
    // Let the rejected save settle and trigger rollback render.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Order reverts to A, B, C (initial).
    const ids = Array.from(container.querySelectorAll('[data-testid^="agent-card-"]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['agent-card-A', 'agent-card-B', 'agent-card-C']);
    // Error message is shown.
    expect(container.textContent).toMatch(/排序保存失败/);
  });

  it('dragging agent B onto agent A calls saveAgentOrder with new order ["B","A","C"]', async () => {
    const agents = [minimalAgent('A'), minimalAgent('B'), minimalAgent('C')];
    const config = { coCreator: null, agents: {} } as unknown as import('../config-viewer-types').ConfigData;

    await act(async () => {
      root.render(React.createElement(AgentOverviewTab, { config, agents }));
    });

    const cardA = container.querySelector('[data-testid="agent-card-A"]') as HTMLElement;
    const cardB = container.querySelector('[data-testid="agent-card-B"]') as HTMLElement;
    expect(cardA).toBeTruthy();
    expect(cardB).toBeTruthy();

    const store = { 'text/plain': '' };
    const dataTransfer = {
      setData: (type: string, value: string) => {
        store[type as 'text/plain'] = value;
      },
      getData: (type: string) => store[type as 'text/plain'] ?? '',
    } as unknown as DataTransfer;

    await act(async () => {
      cardB.dispatchEvent(makeDragEvent('dragstart', dataTransfer));
      cardA.dispatchEvent(makeDragEvent('dragover', dataTransfer));
      cardA.dispatchEvent(makeDragEvent('drop', dataTransfer));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(saveAgentOrderMock).toHaveBeenCalledWith(['B', 'A', 'C']);
  });
});
