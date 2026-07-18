'use client';

import type { BrakeEvent } from '@agent-studio/shared';
import { create } from 'zustand';
import { apiFetch } from '@/utils/api-client';

interface BrakeStoreState {
  visible: boolean;
  level: 1 | 2 | 3;
  activeMinutes: number;
  nightMode: boolean;
  /** Submitting check-in */
  submitting: boolean;
  /** True when bypass exhausted (3+ in 4h) — hide continue button */
  bypassDisabled: boolean;

  /** Settings (AC28+AC31) */
  settingsEnabled: boolean;
  settingsThreshold: number;
  settingsLoading: boolean;

  show: (event: BrakeEvent) => void;
  hide: () => void;
  checkin: (choice: 'rest' | 'wrap_up' | 'continue', reason?: string) => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (patch: { enabled?: boolean; thresholdMinutes?: number }) => Promise<void>;
}

export const useBrakeStore = create<BrakeStoreState>((set, get) => ({
  visible: false,
  level: 1,
  activeMinutes: 0,
  nightMode: false,
  submitting: false,
  bypassDisabled: false,
  settingsEnabled: true,
  settingsThreshold: 90,
  settingsLoading: false,

  show: (event) =>
    set({
      visible: true,
      level: event.level,
      activeMinutes: event.activeMinutes,
      nightMode: event.nightMode,
      submitting: false,
      bypassDisabled: false, // Reset on each new trigger
    }),

  hide: () => set({ visible: false, submitting: false, bypassDisabled: false }),

  checkin: async (choice, reason) => {
    set({ submitting: true });
    try {
      const res = await apiFetch('/api/brake/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice, reason }),
      });
      const data = await res.json();
      if (data.bypassDisabled) {
        set({ submitting: false, bypassDisabled: true });
      } else {
        set({ visible: false, submitting: false, bypassDisabled: false });
      }
    } catch {
      set({ submitting: false });
    }
  },

  loadSettings: async () => {
    set({ settingsLoading: true });
    try {
      const res = await apiFetch('/api/brake/settings');
      const data = await res.json();
      set({ settingsEnabled: data.enabled, settingsThreshold: data.thresholdMinutes, settingsLoading: false });
    } catch {
      set({ settingsLoading: false });
    }
  },

  saveSettings: async (patch) => {
    const prev = { enabled: get().settingsEnabled, thresholdMinutes: get().settingsThreshold };
    // Optimistic update
    if (patch.enabled !== undefined) set({ settingsEnabled: patch.enabled });
    if (patch.thresholdMinutes !== undefined) set({ settingsThreshold: patch.thresholdMinutes });
    try {
      const res = await apiFetch('/api/brake/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.error) {
        // Revert on validation error
        set({ settingsEnabled: prev.enabled, settingsThreshold: prev.thresholdMinutes });
      }
    } catch {
      set({ settingsEnabled: prev.enabled, settingsThreshold: prev.thresholdMinutes });
    }
  },
}));
