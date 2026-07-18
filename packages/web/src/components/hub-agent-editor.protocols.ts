import { protocolForClient as sharedProtocolForClient } from '@agent-studio/shared';
import type { ClientId } from './hub-agent-editor.model';

export function protocolForClient(client: ClientId): 'anthropic' | 'openai' | 'google' | 'kimi' | null {
  return sharedProtocolForClient(client);
}

export function defaultMcpSupportForClient(client: ClientId): boolean {
  return (
    client === 'anthropic' ||
    client === 'openai' ||
    client === 'google' ||
    client === 'kimi' ||
    client === 'opencode' ||
    client === 'antigravity'
  );
}
