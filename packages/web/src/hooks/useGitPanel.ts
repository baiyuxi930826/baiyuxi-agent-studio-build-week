import { useCallback, useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { apiFetch } from '../utils/api-client';

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitStatusResult {
  branch: string;
  staged: Array<{ status: string; path: string }>;
  unstaged: Array<{ status: string; path: string }>;
  untracked: Array<{ status: string; path: string }>;
}

export interface CommitDetail {
  hash: string;
  files: Array<{ path: string; summary: string }>;
}

export function useGitPanel() {
  const worktreeId = useChatStore((s) => s.workspaceWorktreeId);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = useCallback(
    async (limit = 50) => {
      if (!worktreeId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(
          `/api/workspace/git-log?worktreeId=${encodeURIComponent(worktreeId)}&limit=${limit}`,
        );
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setCommits(data.commits);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to fetch git log');
      } finally {
        setLoading(false);
      }
    },
    [worktreeId],
  );

  const fetchStatus = useCallback(async () => {
    if (!worktreeId) return;
    try {
      const res = await apiFetch(`/api/workspace/git-status?worktreeId=${encodeURIComponent(worktreeId)}`);
      if (!res.ok) throw new Error(await res.text());
      setStatus(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch git status');
    }
  }, [worktreeId]);

  const fetchCommitDetail = useCallback(
    async (hash: string) => {
      if (!worktreeId) return;
      setCommitDetail(null);
      try {
        const res = await apiFetch(`/api/workspace/git-show?worktreeId=${encodeURIComponent(worktreeId)}&hash=${hash}`);
        if (!res.ok) throw new Error(await res.text());
        setCommitDetail(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to fetch commit detail');
      }
    },
    [worktreeId],
  );

  const refresh = useCallback(async () => {
    await Promise.all([fetchLog(), fetchStatus()]);
  }, [fetchLog, fetchStatus]);

  return { commits, status, commitDetail, loading, error, fetchLog, fetchStatus, fetchCommitDetail, refresh };
}
