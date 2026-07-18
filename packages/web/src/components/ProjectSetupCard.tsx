/**
 * F113 Phase E: ProjectSetupCard
 * Shown when a thread opens with a project that needs governance bootstrap.
 * Three options: clone repo / git init / skip git.
 * Separate from GovernanceBlockedCard (which handles dispatch-failure retry).
 */
import { useCallback, useState } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { apiFetch } from '@/utils/api-client';
import { AgentHookHealthNotice, type AgentHookStatusResponse } from './AgentHookHealthNotice';
import { HubIcon } from './hub-icons';
import { AgentStudioLogo } from './icons/AgentStudioLogo';

/* Neutral Agent Studio mark for project setup states. */

interface ProjectSetupCardProps {
  projectPath: string;
  isEmptyDir: boolean;
  isGitRepo: boolean;
  gitAvailable: boolean;
  onComplete: () => void;
  agentHookHealth?: AgentHookStatusResponse | null;
  agentHookHealthError?: string | null;
  agentHookSyncing?: boolean;
  agentHookSynced?: boolean;
  onSyncAgentHooks?: () => void | Promise<void>;
}

type CardState = 'idle' | 'processing' | 'done' | 'error';

const ERROR_LABELS: Record<string, string> = {
  auth_failed: '认证失败，请检查仓库权限',
  network_error: '网络错误，无法连接到 Git 服务器',
  not_found: '仓库不存在，请检查 URL',
  not_empty: '目录不为空，无法克隆',
  timeout: '克隆超时（120秒），仓库可能过大',
  git_unavailable: '未检测到 Git，请先安装',
  unknown: '克隆失败，请检查 Git 配置或仓库状态',
};

function SetupAgentMark({ state }: { state: 'idle' | 'processing' | 'done' }) {
  const tone =
    state === 'done'
      ? 'border-semantic-success bg-semantic-success-surface'
      : state === 'processing'
        ? 'border-semantic-warning bg-semantic-warning-surface'
        : 'border-studio-accent/25 bg-studio-surface';

  return (
    <div
      className={`flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl border ${tone}`}
      aria-hidden="true"
    >
      <AgentStudioLogo className="h-12 w-12" />
    </div>
  );
}

export function ProjectSetupCard({
  projectPath,
  isEmptyDir,
  isGitRepo,
  gitAvailable,
  onComplete,
  agentHookHealth,
  agentHookHealthError,
  agentHookSyncing,
  agentHookSynced,
  onSyncAgentHooks,
}: ProjectSetupCardProps) {
  const [state, setState] = useState<CardState>('idle');
  const [cloneUrl, setCloneUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const ime = useIMEGuard();

  const dirName = projectPath.split(/[/\\]/).pop() ?? projectPath;

  const handleSetup = useCallback(
    async (mode: 'clone' | 'init' | 'skip') => {
      setState('processing');
      setErrorMsg('');
      try {
        const payload: Record<string, string> = { projectPath, mode };
        if (mode === 'clone') payload.gitCloneUrl = cloneUrl.trim();

        // Run API call and minimum display time in parallel so fast ops don't flash
        const MIN_DISPLAY_MS = 1200;
        const [res] = await Promise.all([
          apiFetch('/api/projects/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          new Promise((r) => setTimeout(r, MIN_DISPLAY_MS)),
        ]);

        if (!res.ok) {
          const data = await res.json();
          const kind = data.errorKind as string | undefined;
          setState('error');
          setErrorMsg(kind ? (ERROR_LABELS[kind] ?? data.error) : (data.error ?? '初始化失败'));
          return;
        }

        setState('done');
        onComplete();
      } catch {
        setState('error');
        setErrorMsg('网络错误');
      }
    },
    [projectPath, cloneUrl, onComplete],
  );

  // Processing and done states: full card with icon (matches GovernanceBlockedCard)
  if (state === 'processing' || state === 'done') {
    return (
      <div data-testid="project-setup-card" className="flex justify-center mb-3">
        <div
          className={`max-w-[85%] w-full rounded-lg border p-4 ${state === 'done' ? 'border-semantic-success bg-semantic-success-surface' : 'border-semantic-warning bg-semantic-warning-surface'}`}
        >
          <div className="flex items-center gap-4">
            <SetupAgentMark state={state === 'done' ? 'done' : 'processing'} />
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-medium ${state === 'done' ? 'text-semantic-success' : 'text-semantic-warning'}`}
              >
                项目{' '}
                <code
                  className={`px-1 py-0.5 rounded text-xs ${state === 'done' ? 'bg-semantic-success-surface' : 'bg-semantic-warning-surface'}`}
                >
                  {dirName}
                </code>{' '}
                {state === 'done' ? '初始化完成' : '正在初始化'}
              </p>
              <p className={`text-xs mt-1 ${state === 'done' ? 'text-semantic-success' : 'text-semantic-warning'}`}>
                {state === 'done'
                  ? '协作规则（CLAUDE.md 等）、Skills 链接和方法论模板已就绪。'
                  : '正在写入协作规则（CLAUDE.md 等）、Skills 链接和方法论模板...'}
              </p>
              <div className="mt-2">
                {state === 'processing' && (
                  <span className="text-sm text-semantic-warning animate-pulse">正在初始化治理...</span>
                )}
                {state === 'done' && <span className="text-sm text-semantic-success">治理初始化完成，Agent已就绪</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="project-setup-card" className="flex justify-center mb-3">
      <div className="max-w-[85%] w-full rounded-lg border border-studio-accent/20 bg-studio-surface/30 p-5">
        {/* Header */}
        <div className="flex items-center gap-4 mb-4">
          <SetupAgentMark state="idle" />
          <div>
            <p className="text-sm font-medium text-studio-black">发现了一片新大陆！</p>
            <p className="text-xs text-studio-muted mt-0.5">
              项目 <code className="px-1 py-0.5 bg-studio-surface rounded text-micro">{dirName}</code>{' '}
              {isEmptyDir ? '是空目录，' : ''}需要初始化后Agent才能工作。
            </p>
          </div>
        </div>

        {state === 'error' && (
          <div className="mb-3 px-3 py-2 rounded bg-semantic-critical-surface border border-semantic-critical">
            <p className="text-xs text-semantic-critical">{errorMsg}</p>
            <button
              type="button"
              onClick={() => setState('idle')}
              className="text-xs text-semantic-critical underline mt-1"
            >
              重试
            </button>
          </div>
        )}

        {state === 'idle' && (
          <div className="space-y-3">
            {onSyncAgentHooks && (
              <AgentHookHealthNotice
                health={agentHookHealth ? agentHookHealth : null}
                error={agentHookHealthError}
                syncing={agentHookSyncing}
                synced={agentHookSynced}
                onSync={onSyncAgentHooks}
              />
            )}

            <p className="text-xs text-studio-muted font-medium">请选择你的开荒方式：</p>

            {/* Option 1: Clone (recommended) */}
            {isEmptyDir && gitAvailable && !isGitRepo && (
              <div className="rounded-xl ring-1 ring-studio-accent/30 p-4 hover:bg-studio-accent/[0.03] transition-colors">
                <div className="flex items-center gap-3 mb-2.5">
                  <HubIcon name="folder" className="h-5 w-5 text-studio-accent" />
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-studio-black">克隆 Git 仓库</span>
                    <span className="text-micro px-1.5 py-0.5 rounded-full bg-studio-accent/10 text-studio-accent font-medium">
                      推荐
                    </span>
                  </div>
                </div>
                <p className="text-xs text-studio-muted mb-3 ml-8">将现有的代码宝藏搬到新营地，包含完整历史记录。</p>
                <div className="flex gap-2 ml-8">
                  <input
                    type="text"
                    value={cloneUrl}
                    onChange={(e) => setCloneUrl(e.target.value)}
                    onCompositionStart={ime.onCompositionStart}
                    onCompositionEnd={ime.onCompositionEnd}
                    placeholder="https:// 或 git@..."
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-[var(--console-border-soft)] bg-studio-surface-canvas focus:outline-none focus:ring-1 focus:ring-studio-accent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && ime.isComposing()) {
                        e.preventDefault();
                        return;
                      }
                      if (e.key === 'Enter' && cloneUrl.trim()) handleSetup('clone');
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleSetup('clone')}
                    disabled={!cloneUrl.trim()}
                    className="min-w-[6.5rem] px-4 py-2 rounded-lg bg-studio-accent hover:bg-studio-interactive text-[var(--studio-surface)] text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    立即拉取
                  </button>
                </div>
              </div>
            )}

            {/* Option 2: Git init */}
            {gitAvailable && !isGitRepo && (
              <div className="rounded-xl ring-1 ring-studio-accent/30 p-4 hover:bg-studio-accent/[0.03] transition-colors">
                <div className="flex items-center gap-3">
                  <HubIcon name="terminal" className="h-5 w-5 text-studio-accent" />
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-studio-black">初始化全新项目</span>
                    <p className="text-xs text-studio-muted mt-0.5">从零开始，为你铺设标准的协作规则和工作目录。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSetup('init')}
                    className="min-w-[6.5rem] px-4 py-2 rounded-lg bg-studio-accent hover:bg-studio-interactive text-[var(--studio-surface)] text-xs font-medium transition-colors"
                  >
                    初始化
                  </button>
                </div>
              </div>
            )}

            {/* Option 3: Skip git */}
            <div className="rounded-xl ring-1 ring-studio-accent/30 p-4 hover:bg-studio-accent/[0.03] transition-colors">
              <div className="flex items-center gap-3">
                <HubIcon name="settings" className="h-5 w-5 text-studio-accent" />
                <div className="flex-1">
                  <span className="text-sm font-semibold text-studio-black">
                    {isGitRepo ? '初始化协作配置' : '跳过 Git，仅初始化协作'}
                  </span>
                  <p className="text-xs text-studio-muted mt-0.5">
                    {isGitRepo ? '已检测到 Git，仅需铺设协作规则。' : '无版本控制，时光回溯和代码审查功能将不可用。'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleSetup('skip')}
                  className="min-w-[6.5rem] px-4 py-2 rounded-lg bg-studio-accent hover:bg-studio-interactive text-[var(--studio-surface)] text-xs font-medium transition-colors"
                >
                  {isGitRepo ? '初始化' : '跳过'}
                </button>
              </div>
            </div>

            {/* Explanation */}
            <p className="text-micro text-studio-muted px-1 mt-1">
              初始化将写入协作规则（CLAUDE.md 等）、Skills 链接和方法论模板。已有文件不会被覆盖。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
