'use client';

import type { GlobalArtifactDTO, ThreadArtifactDTO, ThreadArtifactType } from '@agent-studio/shared';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { pushThreadRouteWithHistory } from '@/components/ThreadSidebar/thread-navigation';
import { useAgentData } from '@/hooks/useAgentData';
import { useChatStore } from '@/stores/chatStore';
import { API_URL } from '@/utils/api-client';
import { scrollToMessage } from '@/utils/scrollToMessage';
import { kickTeleportResolve, planTeleport } from '@/utils/teleport';
import { useGlobalArtifacts } from '../hooks/useGlobalArtifacts';
import { useThreadArtifacts } from '../hooks/useThreadArtifacts';
import { ArtifactDetailView } from './artifacts/ArtifactDetailView';
import { extractAgentChips, filterByAgent } from './artifacts/artifact-filters';
import type { ArtifactGroup, GroupingMode } from './artifacts/artifact-grouping';
import { groupArtifacts } from './artifacts/artifact-grouping';
import { artifactRowMeta, resolveAssetUrl } from './artifacts/artifact-view';

const resolveUrl = (url?: string): string | undefined => resolveAssetUrl(url, API_URL);

// Inline SVG icons (sandbox/sanitizer-safe: no <symbol>/<use> — see F232 KD-2).
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const IconImage = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...S}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);
const IconFile = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...S}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M9 13h6" />
    <path d="M9 17h4" />
  </svg>
);
const IconCode = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...S}>
    <path d="M16 18l6-6-6-6" />
    <path d="M8 6l-6 6 6 6" />
  </svg>
);
const IconMic = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...S}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
    <path d="M12 18v4" />
  </svg>
);
const IconSearch = () => (
  <svg className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" {...S}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);
const IconArrow = () => (
  <svg className="h-3 w-3" viewBox="0 0 24 24" {...S}>
    <path d="M7 17L17 7" />
    <path d="M8 7h9v9" />
  </svg>
);
const IconLayers = () => (
  <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" {...S}>
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);
const IconX = () => (
  <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" {...S}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

// AC-A9: video play icon (inline SVG, 家规 KD-2)
const IconVideo = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" {...S}>
    <rect x="2" y="4" width="15" height="16" rx="2" />
    <path d="M17 10l5-3v10l-5-3" />
  </svg>
);

// Collapsible group chevron (F232 Phase B grouping)
const IconChevron = ({ open }: { open: boolean }) => (
  <svg className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" {...S}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

const TYPE_ICON: Record<ThreadArtifactType, () => JSX.Element> = {
  image: IconImage,
  file: IconFile,
  code: IconCode,
  pr: IconCode,
  audio: IconMic,
  video: IconVideo,
};

// Type-specific color system (F232 design language — intentionally NOT generic studio tokens).
// These represent artifact type identity; kept as explicit values for visual consistency.
const TYPE_TINT: Record<ThreadArtifactType, { color: string; background: string }> = {
  image: { color: '#4a7fb0', background: '#eef3f8' },
  file: { color: '#b58a45', background: '#f8f2e9' },
  code: { color: '#479a5a', background: '#edf5ef' },
  pr: { color: '#479a5a', background: '#edf5ef' },
  audio: { color: '#8866b0', background: '#f2edf8' },
  video: { color: '#b05a5a', background: '#f8eded' },
};

/** F232 Phase B: extracted row component to reduce ArtifactsPanel cognitive complexity. */
function ArtifactRow({
  a,
  index,
  grouping,
  resolveNick,
  onSelect,
  onJump,
}: {
  a: ThreadArtifactDTO;
  index: number;
  grouping: GroupingMode;
  resolveNick: (id: string) => string | undefined;
  onSelect: (a: ThreadArtifactDTO) => void;
  onJump: (messageId: string, threadId?: string) => void;
}) {
  const Icon = TYPE_ICON[a.type];
  const tint = TYPE_TINT[a.type];
  const url = resolveUrl(a.url);
  const meta = artifactRowMeta(a, resolveNick);
  const global = isGlobal(a);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 整行可点击进入产物详情 + 内嵌跳转/打开按钮，嵌套 interactive 元素无法用 <button>
    <div
      key={`${a.ref ?? a.name}-${index}`}
      data-artifact-row
      role="button"
      tabIndex={0}
      onClick={() => onSelect(a)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(a);
        }
      }}
      className="flex w-full cursor-pointer items-center gap-3 border-b border-studio-subtle px-3 py-2.5 text-left transition-colors hover:bg-studio-surface-elevated/50"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-studio-subtle"
        style={{ color: tint.color, background: tint.background }}
      >
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-studio-secondary">{a.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-micro text-studio-muted">
          <span className="truncate">
            {meta.agentLabel} · {meta.relativeTime}
          </span>
          {/* Phase B: thread badge in global scope (skip when already grouped by thread) */}
          {global && grouping !== 'thread' && (
            <span className="shrink-0 truncate rounded bg-studio-surface-elevated px-1.5 py-0.5 text-micro text-studio-muted">
              {a.threadTitle}
            </span>
          )}
          {a.sourceMessageId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (a.sourceMessageId) onJump(a.sourceMessageId, global ? a.threadId : undefined);
              }}
              className="flex shrink-0 items-center gap-0.5 text-studio-crosspost transition-colors hover:text-studio-accent"
            >
              跳转
              <IconArrow />
            </button>
          )}
        </div>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-lg border border-studio bg-studio-surface-elevated px-2.5 py-1 text-micro text-studio-muted transition-colors hover:text-studio-secondary"
        >
          打开
        </a>
      )}
    </div>
  );
}

type FilterKey = 'all' | 'image' | 'file' | 'codepr' | 'audio' | 'video';
const inFilter = (a: ThreadArtifactDTO, f: FilterKey): boolean =>
  f === 'all' ? true : f === 'codepr' ? a.type === 'code' || a.type === 'pr' : a.type === f;

/** F232 Phase B: scope toggle — 当前对话 vs 全局 */
type ArtifactScope = 'thread' | 'global';

/** Type guard: is this a global artifact (has threadId/threadTitle)? */
function isGlobal(a: ThreadArtifactDTO): a is GlobalArtifactDTO {
  return 'threadId' in a && 'threadTitle' in a;
}

export function ArtifactsPanel({
  threadId,
  width,
  onClose,
}: {
  threadId: string;
  width?: number;
  onClose?: () => void;
}) {
  // F232 Phase B: scope toggle state
  const [scope, setScope] = useState<ArtifactScope>('thread');

  // Data sources: thread-scoped (Phase A) + global (Phase B)
  const threadData = useThreadArtifacts(threadId);
  const globalData = useGlobalArtifacts(scope === 'global');

  // Active data source based on scope
  const { artifacts, loading, error } = scope === 'global' ? globalData : threadData;

  const { getAgentById } = useAgentData();
  const workspaceWorktreeId = useChatStore((s) => s.workspaceWorktreeId);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');
  // AC-A7: 选中产物 → panel 内进入内容详情视图（null = 列表视图）。
  const [selected, setSelected] = useState<ThreadArtifactDTO | null>(null);

  // F232 Phase B: grouping mode (only active in global scope)
  const [grouping, setGrouping] = useState<GroupingMode>('time');
  // F232 Phase B: agent filter (null = show all, agentId string = filter to that agent)
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  // Track collapsed groups by stable id (not label — labels can collide, gpt52 P1)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback(
    (groupId: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      }),
    [],
  );

  // Reset view state when threadId or scope changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: threadId + scope are intentional effect triggers (prop/state change → reset UI state)
  useEffect(() => {
    setSelected(null);
    setFilter('all');
    setQ('');
    setAgentFilter(null);
    setCollapsed(new Set());
  }, [threadId, scope]);

  // F232 P2 (cloud review): 跳回原消息走 teleport（jump-with-load），不裸 scrollToMessage。
  // Phase B: 全局 scope 下 artifact 自带 threadId，teleport 跨 thread 跳转正确。
  const handleJump = useCallback(
    (sourceMessageId: string, artifactThreadId?: string) => {
      const tid = artifactThreadId ?? threadId;
      const currentThreadId = useChatStore.getState().currentThreadId;
      const plan = planTeleport({ threadId: tid, messageId: sourceMessageId, currentThreadId });
      if (plan.scrollNow) {
        scrollToMessage(plan.scrollNow);
        kickTeleportResolve();
      } else if (plan.navigateTo) {
        // Bug1 fix: pathname route (/thread/X), not /?threadId= query (lobby fallback).
        pushThreadRouteWithHistory(plan.navigateTo, window);
      }
    },
    [threadId],
  );

  // F232 Phase B: resolve agentId → display nickname (shared by grouping + agent filter)
  const resolveNickname = useCallback((agentId: string) => getAgentById(agentId)?.nickname, [getAgentById]);

  // F232 Phase B: apply agent filter first, then compute counts on the agent-filtered set
  const agentFiltered = useMemo(
    () => (scope === 'global' ? filterByAgent(artifacts as GlobalArtifactDTO[], agentFilter) : artifacts),
    [artifacts, agentFilter, scope],
  );

  // F232 Phase B: agent chips derived from FULL artifacts (not filtered) so all agents are always visible
  const agentChips = useMemo(
    () => (scope === 'global' ? extractAgentChips(artifacts as GlobalArtifactDTO[], resolveNickname) : []),
    [artifacts, resolveNickname, scope],
  );

  const counts = useMemo(() => {
    const c = { all: agentFiltered.length, image: 0, file: 0, codepr: 0, audio: 0, video: 0 };
    for (const a of agentFiltered) {
      if (a.type === 'image') c.image++;
      else if (a.type === 'file') c.file++;
      else if (a.type === 'audio') c.audio++;
      else if (a.type === 'video') c.video++;
      else c.codepr++; // code | pr
    }
    return c;
  }, [agentFiltered]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return agentFiltered.filter((a) => inFilter(a, filter) && (!needle || a.name.toLowerCase().includes(needle)));
  }, [agentFiltered, filter, q]);

  // F232 Phase B: compute grouped view (only meaningful in global scope)
  const groups: ArtifactGroup[] = useMemo(() => {
    // Thread scope: flat list, no grouping (items typed as ThreadArtifactDTO but we
    // only access shared fields in the row renderer; cast is safe).
    if (scope !== 'global') {
      return [{ id: '__flat', label: '', count: visible.length, items: visible as GlobalArtifactDTO[] }];
    }
    // Global scope: artifacts are always GlobalArtifactDTO from useGlobalArtifacts
    return groupArtifacts(visible as GlobalArtifactDTO[], grouping, resolveNickname);
  }, [visible, grouping, resolveNickname, scope]);

  const groupingChips: Array<[GroupingMode, string]> = [
    ['time', '时间'],
    ['thread', '对话'],
    ['agent', '角色'],
  ];

  const chips: Array<[FilterKey, string, number]> = [
    ['all', '全部', counts.all],
    ['image', '图', counts.image],
    ['file', '文件', counts.file],
    ['codepr', '代码·PR', counts.codepr],
    ['audio', '语音', counts.audio],
    ['video', '视频', counts.video],
  ];

  return (
    <aside
      className="flex flex-col overflow-hidden bg-studio-surface text-studio"
      style={width ? { width, flexShrink: 0 } : { flex: '1 1 0%', minWidth: 0 }}
    >
      {selected ? (
        <ArtifactDetailView
          artifact={selected}
          // P1 fix (gpt52 review): global scope artifact from another thread must NOT use the current
          // thread's worktreeId — that would fetch the wrong file version or 404. Pass null to force
          // fallback to URL/non-workspace content resolution for cross-thread artifacts.
          worktreeId={isGlobal(selected) && selected.threadId !== threadId ? null : workspaceWorktreeId}
          onBack={() => setSelected(null)}
          onJump={(msgId) => handleJump(msgId, isGlobal(selected) ? selected.threadId : undefined)}
        />
      ) : (
        <>
          {/* Header — aligned with TaskBoardPanel / RecallPanel structure */}
          <div className="border-b border-studio px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-studio-secondary">
                <IconLayers />
                产物
              </span>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭"
                  className="flex text-studio-muted transition-colors hover:text-studio-secondary"
                >
                  <IconX />
                </button>
              )}
            </div>

            {/* F232 Phase B: Scope toggle — matches recall panel [记忆流] [拉闸记录] pattern */}
            <div className="mt-2 flex rounded-lg border border-studio-subtle bg-studio-surface-sunken p-0.5">
              {(['thread', 'global'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`flex-1 rounded-md px-2 py-1 text-micro font-medium transition-colors ${
                    scope === s
                      ? 'bg-studio-surface-elevated text-studio-secondary shadow-sm'
                      : 'text-studio-muted hover:text-studio-secondary'
                  }`}
                >
                  {s === 'thread' ? '当前对话' : '全局'}
                </button>
              ))}
            </div>

            <div className="mt-1.5 text-micro text-studio-muted">
              {loading
                ? '加载中…'
                : error
                  ? '加载失败，点筛选可重试'
                  : `共 ${counts.all} 项 · ${counts.image} 图 · ${counts.file} 文件 · ${counts.codepr} 代码/PR · ${counts.audio} 语音 · ${counts.video} 视频`}
            </div>
            <label className="mt-2 flex items-center gap-2 rounded-lg border border-studio-subtle bg-studio-surface-sunken px-2.5 py-1.5 text-xs text-studio-muted">
              <IconSearch />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={scope === 'global' ? '搜索所有对话的产物…' : '在本 thread 的产物里搜…'}
                className="flex-1 bg-transparent text-xs text-studio outline-none placeholder:text-studio-muted"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map(([key, label, n]) => {
                const on = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-micro transition-colors ${
                      on
                        ? 'bg-studio-crosspost/15 font-semibold text-studio-crosspost'
                        : 'bg-studio-surface-elevated text-studio-muted hover:text-studio-secondary'
                    }`}
                  >
                    {label} {n}
                  </button>
                );
              })}
            </div>
            {/* F232 Phase B: Agent filter chips — only in global scope, when multiple agents */}
            {scope === 'global' && agentChips.length > 1 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-micro text-studio-muted">角色:</span>
                <button
                  type="button"
                  onClick={() => setAgentFilter(null)}
                  className={`rounded-full px-2 py-0.5 text-micro transition-colors ${
                    agentFilter === null
                      ? 'bg-studio-crosspost/15 font-semibold text-studio-crosspost'
                      : 'bg-studio-surface-elevated text-studio-muted hover:text-studio-secondary'
                  }`}
                >
                  全部
                </button>
                {agentChips.map((chip) => {
                  const on = agentFilter === chip.agentId;
                  return (
                    <button
                      key={chip.agentId}
                      type="button"
                      onClick={() => setAgentFilter(on ? null : chip.agentId)}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-micro transition-colors ${
                        on
                          ? 'bg-studio-crosspost/15 font-semibold text-studio-crosspost'
                          : 'bg-studio-surface-elevated text-studio-muted hover:text-studio-secondary'
                      }`}
                    >
                      {chip.label} {chip.count}
                    </button>
                  );
                })}
              </div>
            )}
            {/* F232 Phase B: Grouping chips — only in global scope */}
            {scope === 'global' && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-micro text-studio-muted">分组:</span>
                {groupingChips.map(([mode, label]) => {
                  const on = grouping === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setGrouping(mode);
                        setCollapsed(new Set());
                      }}
                      className={`rounded-full px-2 py-0.5 text-micro transition-colors ${
                        on
                          ? 'bg-studio-crosspost/15 font-semibold text-studio-crosspost'
                          : 'bg-studio-surface-elevated text-studio-muted hover:text-studio-secondary'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-studio-muted">{loading ? '' : '该类型暂无产物'}</div>
            ) : (
              groups.map((group) => {
                const isOpen = !collapsed.has(group.id);
                const showHeader = scope === 'global' && group.label !== '';
                return (
                  <div key={group.id}>
                    {showHeader && (
                      <button
                        type="button"
                        onClick={() => toggleCollapse(group.id)}
                        className="flex w-full items-center gap-1.5 border-b border-studio-subtle bg-studio-surface-sunken px-3 py-2 text-left"
                      >
                        <IconChevron open={isOpen} />
                        <span className="flex-1 truncate text-xs font-semibold text-studio-secondary">
                          {group.label}
                        </span>
                        <span className="text-micro text-studio-muted">{group.count}</span>
                      </button>
                    )}
                    {isOpen &&
                      group.items.map((a, i) => (
                        <ArtifactRow
                          key={`${a.ref ?? a.name}-${i}`}
                          a={a}
                          index={i}
                          grouping={grouping}
                          resolveNick={(id) => getAgentById(id)?.nickname}
                          onSelect={setSelected}
                          onJump={handleJump}
                        />
                      ))}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
}
