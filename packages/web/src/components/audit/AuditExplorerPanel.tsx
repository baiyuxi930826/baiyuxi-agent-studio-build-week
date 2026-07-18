'use client';

import React, { useCallback, useState } from 'react';
import { ExternalRuntimeSessionsPanel } from '../runtime-sessions/ExternalRuntimeSessionsPanel';
import { settingsResourceCardClass } from '../SettingsResourceCard';
import { AuditEventsTab } from './AuditEventsTab';
import { SessionEventsViewer } from './SessionEventsViewer';
import { SessionSearchTab } from './SessionSearchTab';

type AuditTab = 'events' | 'session' | 'runtime' | 'search';

export interface AuditExplorerPanelProps {
  threadId: string;
  /** When set externally, auto-switch to session tab and show this session */
  externalSessionId?: string | null;
  externalSessionAgentId?: string;
  /** Called when viewer is closed, so parent can clear its state (enables reopen same session) */
  onCloseSession?: () => void;
}

const TAB_LABELS: Record<AuditTab, string> = {
  events: '审计事件',
  session: 'Session',
  runtime: 'Runtime',
  search: '搜索',
};

export function AuditExplorerPanel({
  threadId,
  externalSessionId,
  externalSessionAgentId,
  onCloseSession,
}: AuditExplorerPanelProps) {
  const [tab, setTab] = useState<AuditTab>('events');
  const [expanded, setExpanded] = useState(true);
  const [viewingSession, setViewingSession] = useState<{ id: string; agentId?: string } | null>(null);

  // Handle external session switch (from SessionChainPanel click or thread switch)
  React.useEffect(() => {
    if (externalSessionId) {
      setViewingSession({ id: externalSessionId, agentId: externalSessionAgentId });
      setTab('session');
      setExpanded(true);
    } else {
      setViewingSession(null);
    }
  }, [externalSessionId, externalSessionAgentId]);

  const handleViewSession = useCallback((sessionId: string, agentId?: string) => {
    setViewingSession({ id: sessionId, agentId });
    setTab('session');
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewingSession(null);
    onCloseSession?.();
  }, [onCloseSession]);

  return (
    <section className={`${settingsResourceCardClass} p-2.5`}>
      <button
        type="button"
        data-testid="audit-explorer-header"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-studio-secondary hover:text-studio"
      >
        <span>审计 & Session</span>
        <span className="text-micro text-studio-muted">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-2">
          {/* Tab bar */}
          <div className="flex console-divider-b mb-2">
            {(['events', 'session', 'runtime', 'search'] as const).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-1 text-micro font-semibold transition-colors
                  ${tab === t ? 'text-[var(--semantic-info)] border-b-2 border-[var(--semantic-info)]' : 'text-studio-muted hover:text-studio-secondary'}`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'events' && <AuditEventsTab threadId={threadId} />}

          {tab === 'session' &&
            (viewingSession ? (
              <SessionEventsViewer
                sessionId={viewingSession.id}
                agentId={viewingSession.agentId}
                onClose={handleCloseViewer}
              />
            ) : (
              <div className="text-xs text-studio-muted py-2">
                点击左侧 Session Chain 中的封存会话，或通过搜索找到 session
              </div>
            ))}

          {tab === 'runtime' && <ExternalRuntimeSessionsPanel onViewSession={handleViewSession} />}

          {tab === 'search' && <SessionSearchTab threadId={threadId} onViewSession={handleViewSession} />}
        </div>
      )}
    </section>
  );
}
