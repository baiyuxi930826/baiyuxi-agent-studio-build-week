'use client';

import { ModalOverlay, type SkillIssue, SkillIssueList } from './skill-issue-view';

interface SkillIssueDetailDialogProps {
  issues: SkillIssue[];
  syncing?: boolean;
  onSync?: () => void;
  onClose: () => void;
}

/**
 * SkillIssueDetailDialog — single-scope (project or global) Skill 异常详情弹窗.
 *
 * F228: renders the backend's display-ready `issues` verbatim (grouped by skill).
 * No summary/staleness cross-referencing — the backend already de-duplicated.
 */
export function SkillIssueDetailDialog({ issues, syncing = false, onSync, onClose }: SkillIssueDetailDialogProps) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-bold text-studio">Skill 异常详情</h3>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-studio-muted hover:text-studio"
        >
          ×
        </button>
      </div>

      <section className="mt-3 min-h-0 flex-1 overflow-y-auto text-xs">
        {issues.length > 0 ? (
          <SkillIssueList issues={issues} />
        ) : (
          <p className="text-studio-muted">暂无 Skill 异常详情。</p>
        )}
      </section>

      {onSync && (
        <div className="mt-4 flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="rounded-lg bg-studio-accent px-3 py-1 text-xs font-semibold text-[var(--studio-accent-foreground)] hover:bg-studio-accent-hover disabled:opacity-40"
          >
            {syncing ? '同步中…' : '立即同步'}
          </button>
        </div>
      )}
    </ModalOverlay>
  );
}
