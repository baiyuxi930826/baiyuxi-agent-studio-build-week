import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';
import { ChatVoiceFeatureControls } from './ChatVoiceFeatureControls';
import { ExportButton } from './ExportButton';
import { AgentStudioLogo } from './icons/AgentStudioLogo';
import { ThreadAgentPill } from './ThreadAgentPill';

interface ChatContainerHeaderProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  threadId: string;
  authPendingCount: number;
  viewMode: 'single' | 'split';
  onToggleViewMode: () => void;
  onOpenMobileStatus: () => void;
  statusPanelOpen: boolean;
  onToggleStatusPanel: () => void;
  /** F092: Default agent for voice companion */
  defaultAgentId: string;
}

export function ChatContainerHeader({
  sidebarOpen,
  onToggleSidebar,
  threadId,
  authPendingCount,
  // F099/OQ-4: viewMode toggle hidden — candidate for removal (KD-7)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  viewMode: _viewMode,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onToggleViewMode: _onToggleViewMode,
  onOpenMobileStatus,
  statusPanelOpen,
  onToggleStatusPanel,
  defaultAgentId,
}: ChatContainerHeaderProps) {
  return (
    <header className="safe-area-top console-topbar">
      <div className="px-4 md:px-5 h-14 flex items-center gap-2">
        <button
          onClick={onToggleSidebar}
          className="console-icon-button inline-flex mr-1 transition-colors"
          title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <AgentStudioLogo className="h-8 w-8" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-studio-black">Baiyuxi Agent Studio</h1>
          <div className="flex items-center gap-2 min-w-0">
            <ThreadIndicator threadId={threadId} />
            {/* F198 Phase C AC-C5: Daemon active indicator */}
            <DaemonActiveIndicator threadId={threadId} />
            {/* F154 Phase B: Preferred agent pill — desktop only (KD-10) */}
            <div className="hidden lg:block flex-shrink-0">
              <ThreadAgentPill threadId={threadId} />
            </div>
          </div>
        </div>
        <ExportButton threadId={threadId} />
        <ChatVoiceFeatureControls threadId={threadId} defaultAgentId={defaultAgentId} />
        {authPendingCount > 0 && (
          <span
            className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-conn-amber-bg text-conn-amber-text text-micro font-bold animate-pulse-subtle"
            title={`${authPendingCount} 个授权请求等待处理`}
          >
            🔐 {authPendingCount}
          </span>
        )}
        {/* Mobile/tablet: status sheet trigger */}
        <button
          onClick={onOpenMobileStatus}
          className="console-icon-button inline-flex ml-1 transition-colors lg:hidden"
          title="打开状态面板"
          aria-label="打开状态面板"
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {/* F232 AC-A8: 单一 panel 开关（桌面 lg:block）；mode 切换从底部工具栏图标触发。
            P2-2：右侧 panel desktop-only，小屏走 MobileStatusSheet。 */}
        <PanelToggle onToggleStatusPanel={onToggleStatusPanel} statusPanelOpen={statusPanelOpen} />
      </div>
    </header>
  );
}

/** F198 Phase C AC-C5: shows amber pill when a bg carrier daemon is running for this thread.
 *  Clicking it navigates to the Settings ops tab. */
function DaemonActiveIndicator({ threadId }: { threadId: string }) {
  const [daemonShortId, setDaemonShortId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await apiFetch(`/api/threads/${threadId}/active-pane`);
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { active?: boolean; daemonShortId?: string };
          setDaemonShortId(body.daemonShortId ?? null);
        } else {
          setDaemonShortId(null);
        }
      } catch {
        if (!cancelled) setDaemonShortId(null);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [threadId]);

  if (!daemonShortId) return null;

  return (
    <button
      type="button"
      onClick={() => router.push('/settings?s=ops&ops=agent-sessions')}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-micro font-mono text-conn-amber-text bg-conn-amber-bg hover:opacity-80 transition-colors flex-shrink-0"
      title={`Daemon ${daemonShortId} 运行中 · 点击查看后台会话`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-conn-amber-text animate-pulse" />
      {daemonShortId}
    </button>
  );
}

/** Tail-preserving truncation for project chip labels.
 * The suffix usually carries the distinguishing worktree or nested directory name. */
export function tailTruncate(name: string, maxLen = 24): string {
  if (name.length <= maxLen) return name;
  return `…${name.slice(-(maxLen - 1))}`;
}

const PROJECT_PATH_COPY_KEYS = new Set(['Enter', ' ']);

/** Thread indicator: shows which thread you're currently chatting in */
export function ThreadIndicator({ threadId }: { threadId: string }) {
  const threads = useChatStore((s) => s.threads);
  const currentThread = threads.find((t) => t.id === threadId);
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const title = currentThread?.title ?? '未命名对话';
  const rawPath = currentThread?.projectPath ?? '';

  useEffect(() => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    setCopied(false);
  }, [threadId, rawPath]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  if (threadId === 'default') {
    return <p className="text-xs text-studio-secondary">大厅 · 个人 Agent 能力工作台</p>;
  }

  // 'default' is a sentinel for threads without a real projectPath — match exact value, not basename
  const rawBasename = rawPath === 'default' ? '' : (rawPath.split(/[/\\]/).pop() ?? '');
  // Map known internal repo basenames to brand name; preserve real project paths for multi-workspace
  const INTERNAL_BASENAMES = ['agent-studio', 'agent-studio-runtime', 'baiyuxi-agent-studio'];
  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME ?? '';
  const projectName = INTERNAL_BASENAMES.includes(rawBasename) && brandName ? brandName : rawBasename;
  const displayName = tailTruncate(projectName);
  const copyPath = rawPath === 'default' ? '' : rawPath;
  const projectChipLabel = copied ? 'copied!' : displayName;

  const handleCopyPath = () => {
    if (!copyPath) return;
    const cb = typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
    if (!cb) return;
    if (typeof cb.writeText !== 'function') return;
    void Promise.resolve()
      .then(() => cb.writeText(copyPath))
      .then(
        () => {
          if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
          setCopied(true);
          copyResetTimerRef.current = setTimeout(() => {
            setCopied(false);
            copyResetTimerRef.current = null;
          }, 1200);
        },
        () => {},
      );
  };

  return (
    <div className="flex min-w-0 items-baseline text-xs text-studio-secondary">
      <span className="truncate min-w-0 font-medium text-studio-secondary" title={title}>
        {title}
      </span>
      {projectName && (
        <span
          className="flex-shrink-0 max-w-[40%] sm:max-w-[200px] overflow-hidden whitespace-nowrap text-studio-muted cursor-pointer hover:text-studio-secondary transition-colors"
          title={copied ? '已复制!' : `点击复制: ${copyPath}`}
          aria-label={copied ? '已复制项目路径' : `点击复制项目路径: ${copyPath}`}
          onClick={handleCopyPath}
          onKeyDown={(e) => {
            if (PROJECT_PATH_COPY_KEYS.has(e.key)) {
              e.preventDefault();
              handleCopyPath();
            }
          }}
          role="button"
          tabIndex={0}
        >
          {' '}
          · {projectChipLabel}
        </span>
      )}
    </div>
  );
}

/**
 * F232 AC-A8: 单一 panel 开关。原 F099 RightPanelToggle + F232 ArtifactsToggle
 * 收敛成一个 toggle——mode 切换从底部工具栏图标触发。桌面 lg:block，小屏走 MobileStatusSheet。
 */
function PanelToggle({
  onToggleStatusPanel,
  statusPanelOpen,
}: {
  onToggleStatusPanel: () => void;
  statusPanelOpen: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggleStatusPanel}
      className={`console-icon-button ml-1 hidden transition-colors lg:inline-flex ${
        statusPanelOpen ? 'text-studio-accent' : 'text-studio-secondary hover:text-studio-accent'
      }`}
      data-active={statusPanelOpen}
      aria-label={statusPanelOpen ? '收起面板' : '打开面板'}
      title={statusPanelOpen ? '收起面板' : '打开面板'}
    >
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M3 4a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 0v12h10V4H5z"
          clipRule="evenodd"
        />
        {statusPanelOpen && <rect x="12" y="4" width="4" height="12" rx="0.5" opacity="0.3" />}
      </svg>
    </button>
  );
}
