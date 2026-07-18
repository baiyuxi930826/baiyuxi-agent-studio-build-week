import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_THREAD_ROUTE_EVENT } from '../ThreadSidebar/thread-navigation';

const apiFetchMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const addToastMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: (selector: (state: { threads: unknown[]; setThreads: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ threads: [], setThreads: vi.fn() }),
}));

vi.mock('../../utils/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('../../stores/toastStore', () => ({
  useToastStore: {
    getState: () => ({ addToast: addToastMock }),
  },
}));

const { BootcampListModal } = await import('../BootcampListModal');

describe('BootcampListModal navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    apiFetchMock.mockReset();
    routerPushMock.mockReset();
    addToastMock.mockReset();
    window.history.replaceState({}, '', '/');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('uses the shared history bridge when opening an existing bootcamp thread', async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        threads: [{ id: 'thread-bootcamp', title: '🎓 Agent 新手工作流', phase: 'phase-2-env-check' }],
      }),
    });
    const onClose = vi.fn();
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    await act(async () => {
      root.render(React.createElement(BootcampListModal, { open: true, onClose, currentThreadId: 'default' }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const button = container.querySelector('[data-testid="bootcamp-item-thread-bootcamp"]');
    expect(button).toBeTruthy();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/thread/thread-bootcamp');
    expect(window.location.pathname).toBe('/thread/thread-bootcamp');
    expect(dispatchSpy.mock.calls.some(([event]) => event.type === CHAT_THREAD_ROUTE_EVENT)).toBe(true);
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error toast when creating a bootcamp thread fails', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/bootcamp/threads') {
        return Promise.resolve({ ok: true, json: async () => ({ threads: [] }) });
      }
      if (path === '/api/threads') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Bootcamp workspace root is not configured' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await act(async () => {
      root.render(React.createElement(BootcampListModal, { open: true, onClose: vi.fn(), currentThreadId: 'default' }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const createButton = container.querySelector('[data-testid="bootcamp-list-create"]');
    expect(createButton).toBeTruthy();

    await act(async () => {
      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(addToastMock).toHaveBeenCalledOnce();
    expect(addToastMock.mock.calls[0]?.[0]).toMatchObject({
      type: 'error',
      title: '训练营创建失败',
      message: 'Bootcamp workspace root is not configured',
    });
  });
});
