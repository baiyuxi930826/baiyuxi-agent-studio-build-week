import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthPendingRequest } from '@/hooks/useAuthorization';
import { useAuthorization } from '@/hooks/useAuthorization';

Object.assign(globalThis as Record<string, unknown>, { React });

// Mock apiFetch
vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ pending: [] }) }),
}));

// Track notification calls
const notifyCalls: string[] = [];
const mockClose = vi.fn();

describe('useAuthorization notification dedup', () => {
  let container: HTMLDivElement;
  let root: Root;
  let capturedHandler: ((data: AuthPendingRequest) => void) | null = null;

  beforeAll(() => {
    // Must use `function` (not arrow) so it can be called with `new`
    const MockNotification = vi.fn().mockImplementation(function (
      this: Record<string, unknown>,
      _title: string,
      opts: { tag: string },
    ) {
      notifyCalls.push(opts.tag);
      this.onclick = null;
      this.close = mockClose;
    });
    Object.assign(MockNotification, {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    });
    Object.defineProperty(globalThis, 'Notification', {
      value: MockNotification,
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    notifyCalls.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
    capturedHandler = null;
  });

  function HookCapture({ threadId }: { threadId: string }) {
    const { handleAuthRequest } = useAuthorization(threadId);
    capturedHandler = handleAuthRequest;
    return null;
  }

  it('does not fire duplicate notifications for the same requestId', async () => {
    await act(async () => {
      root.render(React.createElement(HookCapture, { threadId: 'thread-1' }));
    });

    const request: AuthPendingRequest = {
      requestId: 'req-1',
      agentId: 'opus',
      threadId: 'thread-1',
      action: 'file_write',
      reason: 'Need to write a file',
      createdAt: Date.now(),
    };

    // First call → should notify
    act(() => {
      capturedHandler?.(request);
    });
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]).toBe('auth-req-1');

    // Duplicate → should NOT notify again
    act(() => {
      capturedHandler?.(request);
    });
    expect(notifyCalls).toHaveLength(1);

    // Different requestId → should notify
    act(() => {
      capturedHandler?.({ ...request, requestId: 'req-2' });
    });
    expect(notifyCalls).toHaveLength(2);
    expect(notifyCalls[1]).toBe('auth-req-2');
  });
});
