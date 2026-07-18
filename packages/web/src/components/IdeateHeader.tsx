'use client';

import { AgentStudioLogo } from './icons/AgentStudioLogo';

/**
 * IdeateHeader — 独立观点采样横幅
 * Shown when parallel (ideate) mode is active.
 * Displays above the message area with a gradient background.
 */
export function IdeateHeader() {
  return (
    <div className="px-5 py-2.5 bg-gradient-to-r from-opus-bg via-codex-bg to-gemini-bg border-b border-studio">
      <div className="flex items-center gap-2">
        <span className="animate-pulse">
          <AgentStudioLogo className="h-4 w-4" />
        </span>
        <span className="text-sm font-medium text-studio-secondary">独立观点采样中</span>
        <span className="text-xs text-studio-muted">Agent们各自独立思考中...</span>
      </div>
    </div>
  );
}
