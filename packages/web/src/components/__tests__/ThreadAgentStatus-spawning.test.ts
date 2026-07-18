import { describe, expect, it } from 'vitest';
import { getAgentStatusType } from '../ThreadAgentStatus';

/**
 * F118 D2: spawning status must be recognized as 'working' by aggregate functions.
 *
 * P1 from codex review: split-pane / sidebar showed 'idle' during spawning
 * because aggregateStatus only checked streaming|pending, not spawning.
 */
describe('getAgentStatusType recognizes spawning as working', () => {
  it('returns working when a agent is spawning', () => {
    expect(getAgentStatusType({ opus: 'spawning' })).toBe('working');
  });

  it('returns working when one agent spawning and another done', () => {
    expect(getAgentStatusType({ opus: 'spawning', codex: 'done' })).toBe('working');
  });

  it('returns error when one agent errors even if another is spawning', () => {
    expect(getAgentStatusType({ opus: 'spawning', codex: 'error' })).toBe('error');
  });

  it('returns working when mixing spawning with streaming', () => {
    expect(getAgentStatusType({ opus: 'spawning', codex: 'streaming' })).toBe('working');
  });
});
