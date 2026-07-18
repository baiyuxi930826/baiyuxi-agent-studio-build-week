import { describe, expect, it } from 'vitest';
import { buildAgentOptions, buildWhisperOptions } from '@/components/chat-input-options';
import type { AgentData } from '@/hooks/useAgentData';

const FAKE_CATS: AgentData[] = [
  {
    id: 'gemini',
    displayName: 'Andy（界面与视觉）',
    color: { primary: '#5B9BD5', secondary: '#D6E9F8' },
    mentionPatterns: ['Andy', 'Andy（界面与视觉）', 'gemini'],
    clientId: 'google',
    defaultModel: 'gemini-3-pro',
    avatar: '/avatars/default.svg',
    roleDescription: '视觉设计师',
    personality: '活泼有创意',
  },
];

const MIXED_CATS: AgentData[] = [
  ...FAKE_CATS,
  {
    id: 'opus-fast',
    displayName: 'Ethan（任务主控与实现）(快)',
    color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
    mentionPatterns: [],
    clientId: 'anthropic',
    defaultModel: 'opus-fast',
    avatar: '/avatars/default.svg',
    roleDescription: '快速变体',
    personality: 'kind',
  },
  {
    id: 'spark',
    displayName: '火花智能体',
    color: { primary: '#F59E0B', secondary: '#FDE68A' },
    mentionPatterns: ['spark'],
    clientId: 'openai',
    defaultModel: 'gpt-5.4-mini',
    avatar: '/avatars/default.svg',
    roleDescription: '精确点改',
    personality: 'fast',
    roster: {
      family: 'code-reviewer',
      roles: ['coder'],
      lead: false,
      available: false,
      evaluation: 'disabled for test',
    },
  },
];

describe('chat input mention option labels', () => {
  it('uses official Andy（界面与视觉） label/insert for gemini option', () => {
    const options = buildAgentOptions(FAKE_CATS);
    const geminiOption = options.find((opt) => opt.id === 'gemini');
    expect(geminiOption).toBeDefined();
    expect(geminiOption?.label).toBe('@Andy（界面与视觉）');
    expect(geminiOption?.insert).toBe('@Andy ');
  });

  it('only uses the first mention pattern for autocomplete insert text', () => {
    const options = buildAgentOptions(FAKE_CATS);
    const gemini = options.find((opt) => opt.id === 'gemini');
    expect(gemini?.insert).toBe('@Andy ');
    expect(gemini?.insert).not.toBe('@Andy（界面与视觉） ');
    expect(gemini?.insert).not.toBe('@gemini ');
  });
});

describe('buildAgentOptions vs buildWhisperOptions split', () => {
  it('buildAgentOptions filters out agents with empty mentionPatterns', () => {
    const options = buildAgentOptions(MIXED_CATS);
    const individuals = options.filter((opt) => !opt.isGroup);
    expect(individuals).toHaveLength(1);
    expect(individuals[0].id).toBe('gemini');
  });

  it('buildAgentOptions filters out unavailable agents even when they have mention patterns', () => {
    const options = buildAgentOptions(MIXED_CATS);
    expect(options.map((option) => option.id)).not.toContain('spark');
  });

  it('buildAgentOptions places group mentions (@thread, @all) after individual agents', () => {
    const options = buildAgentOptions(FAKE_CATS);
    const groups = options.filter((opt) => opt.isGroup);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups.find((g) => g.insert === '@thread ')).toBeDefined();
    expect(groups.find((g) => g.insert === '@all ')).toBeDefined();
    // Individual agents come before group mentions (groups are low-frequency)
    const lastIndividualIdx = options.reduce((max, opt, i) => (!opt.isGroup ? i : max), -1);
    const firstGroupIdx = options.findIndex((opt) => opt.isGroup);
    expect(lastIndividualIdx).toBeLessThan(firstGroupIdx);
  });

  it('buildWhisperOptions includes agents with empty mentionPatterns', () => {
    const options = buildWhisperOptions(MIXED_CATS);
    expect(options).toHaveLength(2);
    const fast = options.find((o) => o.id === 'opus-fast');
    expect(fast).toBeDefined();
    expect(fast?.label).toBe('@Ethan（任务主控与实现）(快)');
    expect(fast?.insert).toBe(''); // no mentionPatterns → empty insert
    expect(options.map((option) => option.id)).not.toContain('spark');
  });
});
