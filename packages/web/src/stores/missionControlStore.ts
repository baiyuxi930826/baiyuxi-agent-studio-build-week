import type { BacklogItem, ThreadPhase } from '@agent-studio/shared';
import { create } from 'zustand';

interface MissionControlState {
  items: BacklogItem[];
  loading: boolean;
  submitting: boolean;
  selectedItemId: string | null;
  selectedPhase: ThreadPhase;
  error: string | null;
  setItems: (items: BacklogItem[]) => void;
  setLoading: (loading: boolean) => void;
  setSubmitting: (submitting: boolean) => void;
  setSelectedItemId: (id: string | null) => void;
  setSelectedPhase: (phase: ThreadPhase) => void;
  setError: (error: string | null) => void;
}

export const useMissionControlStore = create<MissionControlState>((set) => ({
  items: [],
  loading: false,
  submitting: false,
  selectedItemId: null,
  selectedPhase: 'coding',
  error: null,
  setItems: (items) => set({ items }),
  setLoading: (loading) => set({ loading }),
  setSubmitting: (submitting) => set({ submitting }),
  setSelectedItemId: (selectedItemId) => set({ selectedItemId }),
  setSelectedPhase: (selectedPhase) => set({ selectedPhase }),
  setError: (error) => set({ error }),
}));
