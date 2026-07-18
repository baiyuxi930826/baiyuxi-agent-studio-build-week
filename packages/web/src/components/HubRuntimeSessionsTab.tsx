'use client';

import { useState } from 'react';
import { SessionEventsViewer } from './audit/SessionEventsViewer';
import { ExternalRuntimeSessionsPanel } from './runtime-sessions/ExternalRuntimeSessionsPanel';

export function HubRuntimeSessionsTab() {
  const [selectedSession, setSelectedSession] = useState<{ sessionId: string; agentId?: string } | null>(null);

  return (
    <div className="space-y-4 p-4">
      <ExternalRuntimeSessionsPanel
        onViewSession={(sessionId, agentId) => setSelectedSession({ sessionId, agentId })}
        className="max-w-5xl"
      />
      {selectedSession && (
        <div className="max-w-5xl">
          <SessionEventsViewer
            sessionId={selectedSession.sessionId}
            agentId={selectedSession.agentId}
            onClose={() => setSelectedSession(null)}
          />
        </div>
      )}
    </div>
  );
}
