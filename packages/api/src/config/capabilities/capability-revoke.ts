import type { CapabilityEntry } from '@agent-studio/shared';

interface RevokeResult {
  entry: CapabilityEntry;
  revokedBy: string;
  revokedAt: string;
  auditAction: 'revoke';
}

export function revokeCapability(entry: CapabilityEntry, revoker: string): RevokeResult {
  if (entry.source === 'agent-studio') {
    throw new Error(`cannot revoke agent-studio source capability: ${entry.id}`);
  }

  return {
    entry: { ...entry, enabled: false },
    revokedBy: revoker,
    revokedAt: new Date().toISOString(),
    auditAction: 'revoke',
  };
}
