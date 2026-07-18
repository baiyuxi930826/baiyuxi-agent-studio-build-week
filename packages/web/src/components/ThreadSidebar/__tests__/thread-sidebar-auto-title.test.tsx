import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadItem } from '../ThreadItem';
import {
  addToastMock,
  createThreadSidebarHarness,
  installThreadSidebarGlobals,
  jsonOk,
  mockApiFetch,
  mockStore,
  resetThreadSidebarGlobals,
  resetThreadSidebarMocks,
} from './thread-sidebar-test-helpers';

describe('ThreadItem auto title action', () => {
  let container: HTMLDivElement;
  let root: Root;
  let promptSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    installThreadSidebarGlobals();
  });

  beforeEach(() => {
    resetThreadSidebarMocks();
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('根据整个任务内容生成一个简洁标题');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    promptSpy.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    resetThreadSidebarGlobals();
  });

  it('asks for a prompt and sends it to the auto rename handler', async () => {
    const onAutoRename = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <ThreadItem
          id="thread-auto-title"
          title="Old Title"
          participants={[]}
          lastActiveAt={Date.now()}
          isActive={false}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onAutoRename={onAutoRename}
        />,
      );
    });

    const moreButton = container.querySelector('button[title="更多操作"]') as HTMLButtonElement | null;
    expect(moreButton).toBeTruthy();
    await act(async () => {
      moreButton?.click();
    });

    const autoTitleButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('自动重命名'),
    );
    expect(autoTitleButton).toBeTruthy();

    await act(async () => {
      autoTitleButton?.click();
    });

    expect(onAutoRename).toHaveBeenCalledWith('thread-auto-title', '根据整个任务内容生成一个简洁标题');
  });

  it('disables the auto rename action while a generated title is pending', async () => {
    let resolveRename: (() => void) | undefined;
    const onAutoRename = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRename = resolve;
        }),
    );
    await act(async () => {
      root.render(
        <ThreadItem
          id="thread-auto-title"
          title="Old Title"
          participants={[]}
          lastActiveAt={Date.now()}
          isActive={false}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onAutoRename={onAutoRename}
        />,
      );
    });

    const moreButton = container.querySelector('button[title="更多操作"]') as HTMLButtonElement | null;
    await act(async () => {
      moreButton?.click();
    });

    const autoTitleButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('自动重命名'),
    ) as HTMLButtonElement | undefined;
    expect(autoTitleButton).toBeTruthy();

    await act(async () => {
      autoTitleButton?.click();
    });

    await act(async () => {
      moreButton?.click();
    });
    const pendingButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('命名中...'),
    ) as HTMLButtonElement | undefined;
    expect(pendingButton?.disabled).toBe(true);

    await act(async () => {
      resolveRename?.();
    });
  });
});

describe('ThreadSidebar auto title confirmation', () => {
  const thread = {
    id: 'thread-auto-title',
    title: 'Old Title',
    projectPath: 'default',
    createdBy: 'default-user',
    participants: [],
    lastActiveAt: Date.now(),
    createdAt: Date.now(),
    pinned: false,
    favorited: false,
    preferredAgents: [],
  };

  let promptSpy: ReturnType<typeof vi.spyOn>;
  let harness: ReturnType<typeof createThreadSidebarHarness>;

  beforeAll(() => {
    installThreadSidebarGlobals();
  });

  beforeEach(() => {
    resetThreadSidebarMocks();
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('根据整个任务内容生成一个简洁标题');
    mockStore.threads = [thread];
    mockStore.currentThreadId = 'default';
    mockStore.setThreads = vi.fn((threads) => {
      mockStore.threads = threads;
    });
    mockStore.updateThreadTitle = vi.fn();
    mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/threads') return jsonOk({ threads: [thread] });
      if (path === '/api/governance/health') return jsonOk({ projects: [] });
      if (path === '/api/threads/thread-auto-title/auto-title' && init?.method === 'POST') {
        return jsonOk({ title: '候选会话名称' });
      }
      if (path === '/api/threads/thread-auto-title' && init?.method === 'PATCH') {
        return jsonOk({ title: '编辑后的会话名称' });
      }
      return jsonOk({});
    });
    harness = createThreadSidebarHarness();
  });

  afterEach(() => {
    promptSpy.mockRestore();
    harness.cleanup();
  });

  afterAll(() => {
    resetThreadSidebarGlobals();
  });

  async function openAutoRenameAction() {
    await harness.render();
    const expandBtn = harness.container.querySelector('[data-testid="expand-all-btn"]') as HTMLButtonElement | null;
    if (expandBtn) {
      await act(async () => {
        expandBtn.click();
      });
    }

    const moreButton = harness.container.querySelector('button[title="更多操作"]') as HTMLButtonElement | null;
    expect(moreButton).toBeTruthy();
    await act(async () => {
      moreButton?.click();
    });

    const autoTitleButton = Array.from(harness.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('自动重命名'),
    ) as HTMLButtonElement | undefined;
    expect(autoTitleButton).toBeTruthy();
    await act(async () => {
      autoTitleButton?.click();
    });
    await harness.flush();
  }

  it('shows the generated title as an editable candidate before applying it', async () => {
    await openAutoRenameAction();

    expect(mockStore.updateThreadTitle).not.toHaveBeenCalled();
    expect(harness.container.textContent).toContain('应用会话名称');

    const candidateInput = harness.container.querySelector(
      '[data-testid="auto-title-candidate-input"]',
    ) as HTMLInputElement | null;
    expect(candidateInput).toBeTruthy();
    expect(candidateInput?.value).toBe('候选会话名称');

    await act(async () => {
      candidateInput?.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(candidateInput, '编辑后的会话名称');
      candidateInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const applyButton = Array.from(harness.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('应用名称'),
    ) as HTMLButtonElement | undefined;
    expect(applyButton).toBeTruthy();

    await act(async () => {
      applyButton?.click();
    });
    await harness.flush();

    const patchCall = mockApiFetch.mock.calls.find(
      (call) =>
        call[0] === '/api/threads/thread-auto-title' && (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({ title: '编辑后的会话名称' });
    expect(mockStore.updateThreadTitle).toHaveBeenCalledWith('thread-auto-title', '编辑后的会话名称');
    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: '已更新会话名称', message: '编辑后的会话名称' }),
    );
  });

  it('does not apply the generated title when Enter confirms IME composition', async () => {
    await openAutoRenameAction();

    const candidateInput = harness.container.querySelector(
      '[data-testid="auto-title-candidate-input"]',
    ) as HTMLInputElement | null;
    expect(candidateInput).toBeTruthy();

    await act(async () => {
      candidateInput?.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      candidateInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await harness.flush();

    expect(mockApiFetch.mock.calls).not.toContainEqual([
      '/api/threads/thread-auto-title',
      expect.objectContaining({ method: 'PATCH' }),
    ]);
    expect(mockStore.updateThreadTitle).not.toHaveBeenCalled();
  });

  it('ignores stale auto-title response bodies when a newer request finishes first', async () => {
    const firstThread = { ...thread, id: 'thread-first', title: 'First Thread' };
    const secondThread = { ...thread, id: 'thread-second', title: 'Second Thread' };
    let resolveFirstJson: ((value: { title: string }) => void) | undefined;
    mockStore.threads = [firstThread, secondThread];
    mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/threads') return jsonOk({ threads: [firstThread, secondThread] });
      if (path === '/api/governance/health') return jsonOk({ projects: [] });
      if (path === '/api/threads/thread-first/auto-title' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            new Promise((resolve) => {
              resolveFirstJson = resolve;
            }),
        } as Response);
      }
      if (path === '/api/threads/thread-second/auto-title' && init?.method === 'POST') {
        return jsonOk({ title: 'Second Candidate' });
      }
      return jsonOk({});
    });

    await harness.render();
    const expandBtn = harness.container.querySelector('[data-testid="expand-all-btn"]') as HTMLButtonElement | null;
    if (expandBtn) {
      await act(async () => {
        expandBtn.click();
      });
    }

    async function startAutoRename(threadId: string) {
      const threadNode = harness.container.querySelector(`[data-thread-id="${threadId}"]`) as HTMLElement | null;
      expect(threadNode).toBeTruthy();
      const moreButton = threadNode?.querySelector('button[title="更多操作"]') as HTMLButtonElement | null;
      expect(moreButton).toBeTruthy();
      await act(async () => {
        moreButton?.click();
      });

      const autoTitleButton = Array.from(threadNode?.querySelectorAll('button') ?? []).find((button) =>
        button.textContent?.includes('自动重命名'),
      ) as HTMLButtonElement | undefined;
      expect(autoTitleButton).toBeTruthy();
      await act(async () => {
        autoTitleButton?.click();
      });
    }

    await startAutoRename('thread-first');
    await startAutoRename('thread-second');
    await harness.flush();

    const candidateInput = harness.container.querySelector(
      '[data-testid="auto-title-candidate-input"]',
    ) as HTMLInputElement | null;
    expect(candidateInput?.value).toBe('Second Candidate');

    await act(async () => {
      resolveFirstJson?.({ title: 'First Candidate' });
    });
    await harness.flush();

    const currentCandidateInput = harness.container.querySelector(
      '[data-testid="auto-title-candidate-input"]',
    ) as HTMLInputElement | null;
    expect(currentCandidateInput?.value).toBe('Second Candidate');
  });

  it('does not show auto rename for system-owned threads', async () => {
    const systemThread = {
      ...thread,
      id: 'thread-system',
      title: '系统线程',
      createdBy: 'system',
    };
    mockStore.threads = [systemThread];
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/api/threads') return jsonOk({ threads: [systemThread] });
      if (path === '/api/governance/health') return jsonOk({ projects: [] });
      return jsonOk({});
    });
    await harness.render();

    const expandBtn = harness.container.querySelector('[data-testid="expand-all-btn"]') as HTMLButtonElement | null;
    if (expandBtn) {
      await act(async () => {
        expandBtn.click();
      });
    }

    const threadNode = harness.container.querySelector('[data-thread-id="thread-system"]') as HTMLElement | null;
    expect(threadNode).toBeTruthy();
    const moreButton = threadNode?.querySelector('button[title="更多操作"]') as HTMLButtonElement | null;
    expect(moreButton).toBeTruthy();
    await act(async () => {
      moreButton?.click();
    });

    const autoTitleButton = Array.from(threadNode?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('自动重命名'),
    );
    expect(autoTitleButton).toBeUndefined();
  });
});
