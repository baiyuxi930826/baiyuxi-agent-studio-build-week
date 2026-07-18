import { useCallback, useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { apiFetch } from '../utils/api-client';

export interface StaleBranch {
  name: string;
  lastCommitDate: string;
  author: string;
  mergedInto: string;
}

export interface WorktreeHealth {
  path: string;
  branch: string;
  head: string;
  isOrphan: boolean;
}

export interface DriftCommit {
  short: string;
  subject: string;
}

export interface RuntimeDrift {
  available: boolean;
  aheadOfMain: number;
  behindMain: number;
  runtimeHead: string;
  mainHead: string;
  behindCommits: DriftCommit[];
}

export interface GitHealthResult {
  staleBranches: StaleBranch[];
  worktrees: WorktreeHealth[];
  runtimeDrift: RuntimeDrift | null;
}

export function useGitHealth() {
  const worktreeId = useChatStore((s) => s.workspaceWorktreeId);
  const [health, setHealth] = useState<GitHealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    if (!worktreeId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/workspace/git-health?worktreeId=${encodeURIComponent(worktreeId)}`);
      if (!res.ok) throw new Error(await res.text());
      setHealth(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch git health');
    } finally {
      setLoading(false);
    }
  }, [worktreeId]);

  return { health, loading, error, fetchHealth };
}
