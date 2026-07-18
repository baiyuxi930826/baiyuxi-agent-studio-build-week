/**
 * F232 Phase B: Agent filter logic — extract unique agents from artifacts
 * and filter by agentId. Pure functions, no React dependency.
 */
import type { GlobalArtifactDTO } from '@agent-studio/shared';
import { describe, expect, it } from 'vitest';
import { extractAgentChips, filterByAgent } from '../artifacts/artifact-filters';

function makeArtifact(overrides: Partial<GlobalArtifactDTO> & { name: string }): GlobalArtifactDTO {
  return {
    type: 'file',
    agentId: 'opus',
    createdAt: Date.now(),
    sourceMessageId: 'msg-1',
    threadId: 'T-1',
    threadTitle: 'Thread One',
    ...overrides,
  } as GlobalArtifactDTO;
}

const ARTIFACTS: GlobalArtifactDTO[] = [
  makeArtifact({ name: 'a.png', type: 'image', agentId: 'opus' }),
  makeArtifact({ name: 'b.md', agentId: 'opus' }),
  makeArtifact({ name: 'c.pdf', agentId: 'codex' }),
  makeArtifact({ name: 'd.ts', agentId: 'codex' }),
  makeArtifact({ name: 'e.mp3', type: 'audio', agentId: 'sonnet' }),
];

/** Fixtures including null agentId (system/unknown origin — ThreadArtifactDTO allows it) */
const ARTIFACTS_WITH_NULL: GlobalArtifactDTO[] = [
  ...ARTIFACTS,
  makeArtifact({ name: 'system.log', agentId: null }),
  makeArtifact({ name: 'auto-gen.txt', agentId: null }),
];

describe('F232 agent filter', () => {
  describe('extractAgentChips', () => {
    const resolve = (id: string) => ({ opus: '宪宪', codex: '砚砚', sonnet: 'Ethan（任务主控与实现） Sonnet' })[id];

    it('returns unique agents sorted by count descending', () => {
      const chips = extractAgentChips(ARTIFACTS, resolve);
      expect(chips.length).toBe(3);
      // opus: 2, codex: 2, sonnet: 1
      expect(chips[0].count).toBeGreaterThanOrEqual(chips[1].count);
      expect(chips[1].count).toBeGreaterThanOrEqual(chips[2].count);
    });

    it('uses nickname as label, agentId as key', () => {
      const chips = extractAgentChips(ARTIFACTS, resolve);
      const opusChip = chips.find((c) => c.agentId === 'opus');
      expect(opusChip?.label).toBe('宪宪');
    });

    it('falls back to agentId when nickname not found', () => {
      const chips = extractAgentChips(ARTIFACTS, () => undefined);
      expect(chips.some((c) => c.label === 'opus')).toBe(true);
    });

    it('returns empty array for empty artifacts', () => {
      expect(extractAgentChips([], resolve)).toEqual([]);
    });

    it('counts correctly', () => {
      const chips = extractAgentChips(ARTIFACTS, resolve);
      const opusChip = chips.find((c) => c.agentId === 'opus');
      expect(opusChip?.count).toBe(2);
      const sonnetChip = chips.find((c) => c.agentId === 'sonnet');
      expect(sonnetChip?.count).toBe(1);
    });

    it('normalizes null agentId to "—" chip', () => {
      const chips = extractAgentChips(ARTIFACTS_WITH_NULL, resolve);
      const unknownChip = chips.find((c) => c.agentId === '—');
      expect(unknownChip).toBeDefined();
      expect(unknownChip?.count).toBe(2);
      expect(unknownChip?.label).toBe('—'); // no nickname resolver for '—'
    });
  });

  describe('filterByAgent', () => {
    it('returns all when agentId is null', () => {
      expect(filterByAgent(ARTIFACTS, null)).toEqual(ARTIFACTS);
    });

    it('filters to matching agentId', () => {
      const result = filterByAgent(ARTIFACTS, 'opus');
      expect(result.length).toBe(2);
      expect(result.every((a) => a.agentId === 'opus')).toBe(true);
    });

    it('returns empty for nonexistent agentId', () => {
      expect(filterByAgent(ARTIFACTS, 'nonexistent')).toEqual([]);
    });

    it('filters null-agentId artifacts when sentinel "—" is selected', () => {
      const result = filterByAgent(ARTIFACTS_WITH_NULL, '—');
      expect(result.length).toBe(2);
      expect(result.every((a) => a.agentId === null)).toBe(true);
    });

    it('still filters named agents correctly with null-agentId artifacts present', () => {
      const result = filterByAgent(ARTIFACTS_WITH_NULL, 'opus');
      expect(result.length).toBe(2);
      expect(result.every((a) => a.agentId === 'opus')).toBe(true);
    });
  });
});
