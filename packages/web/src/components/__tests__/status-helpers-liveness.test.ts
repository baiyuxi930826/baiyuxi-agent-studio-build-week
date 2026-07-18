import { describe, expect, it } from 'vitest';
import { deriveActiveAgents, statusLabel, statusTone } from '../status-helpers';

describe('statusLabel — liveness states (F118 AC-C1)', () => {
  it('returns 静默等待 for alive_but_silent', () => {
    expect(statusLabel('alive_but_silent')).toBe('静默等待');
  });

  it('returns 疑似卡住 for suspected_stall', () => {
    expect(statusLabel('suspected_stall')).toBe('疑似卡住');
  });
});

describe('statusTone — liveness states (F118 AC-C1)', () => {
  it('returns amber for alive_but_silent', () => {
    expect(statusTone('alive_but_silent')).toBe('text-amber-500');
  });

  it('returns orange for suspected_stall', () => {
    expect(statusTone('suspected_stall')).toBe('text-orange-600');
  });
});

describe('deriveActiveAgents — slot-first truth source', () => {
  it('keeps legacy targetAgents behavior when slot metadata is absent', () => {
    expect(deriveActiveAgents({ targetAgents: ['opus'], snapshotAgents: ['codex'] })).toEqual(['opus', 'codex']);
  });

  it('prefers invocation slots over stale targetAgents', () => {
    const active = deriveActiveAgents({
      targetAgents: ['codex'],
      snapshotAgents: [],
      hasActiveInvocation: true,
      activeInvocations: {
        'inv-1': { agentId: 'dare', mode: 'execute' },
      },
    });

    expect(active).toEqual(['dare']);
  });

  it('drops targetAgents after invocation ends when no slots remain', () => {
    const active = deriveActiveAgents({
      targetAgents: ['codex'],
      snapshotAgents: [],
      hasActiveInvocation: false,
      activeInvocations: {},
    });

    expect(active).toEqual([]);
  });

  it('keeps targetAgents as degraded fallback while invocation is still active but slots are not ready', () => {
    const active = deriveActiveAgents({
      targetAgents: ['opus'],
      snapshotAgents: [],
      hasActiveInvocation: true,
      activeInvocations: {},
    });

    expect(active).toEqual(['opus']);
  });

  it('returns agents from invocation slots when targetAgents is empty', () => {
    const active = deriveActiveAgents({
      targetAgents: [],
      snapshotAgents: [],
      hasActiveInvocation: true,
      activeInvocations: {
        'inv-1': { agentId: 'opus', mode: 'ideate' },
        'inv-2': { agentId: 'codex', mode: 'execute' },
      },
    });

    expect(active).toEqual(['opus', 'codex']);
  });

  it('dedupes repeated agents across multiple live invocation slots', () => {
    const active = deriveActiveAgents({
      targetAgents: [],
      snapshotAgents: [],
      hasActiveInvocation: true,
      activeInvocations: {
        'inv-1': { agentId: 'opus', mode: 'ideate' },
        'inv-2': { agentId: 'opus', mode: 'execute' },
        'inv-3': { agentId: 'codex', mode: 'execute' },
      },
    });

    expect(active).toEqual(['opus', 'codex']);
  });
});

describe('F194 Phase Z5 AC-Z15: ideate mode preserves targetAgents union', () => {
  // co-creator alpha catch 2026-05-10 04:51："并发 at 47 和 55 但是观点采样面板只显示 47"
  // 根因：opus-47 完成后其 slot 被 markThreadInvocationComplete 清掉 →
  // deriveActiveAgents 从两个角色塌成一只还在 streaming 的智能体 → 47 卡片消失
  //
  // 修复：ideate mode 下 deriveActiveAgents fallback 到 targetAgents UNION（不只看 slots），
  // 保留本轮所有 targetAgents 让卡片全程显示，slot 只决定每个角色的最终状态展示

  it('AC-Z15: ideate mode keeps both agents visible after one finishes (slot removed)', () => {
    const active = deriveActiveAgents({
      targetAgents: ['opus-47', 'gpt-55'],
      snapshotAgents: [],
      hasActiveInvocation: true,
      activeInvocations: {
        // opus-47 已完成，slot 被 removeActiveInvocation 清掉
        'inv-2': { agentId: 'gpt-55', mode: 'ideate' },
      },
      intentMode: 'ideate',
    });

    // GREEN after Z5: 两个智能体都在 (targetAgents union, slot 状态由 callback statuses 决定)
    // RED before Z5: 只有 gpt-55，opus-47 因 slot 移除消失
    expect(active.sort()).toEqual(['gpt-55', 'opus-47']);
  });

  it('AC-Z15: ideate mode union of targetAgents + slotAgents + snapshotAgents (no duplicates)', () => {
    const active = deriveActiveAgents({
      targetAgents: ['opus-47', 'gpt-55'],
      snapshotAgents: ['gemini'],
      hasActiveInvocation: true,
      activeInvocations: {
        'inv-1': { agentId: 'opus-47', mode: 'ideate' },
        'inv-2': { agentId: 'gpt-55', mode: 'ideate' },
      },
      intentMode: 'ideate',
    });

    expect(active.sort()).toEqual(['gemini', 'gpt-55', 'opus-47']);
  });

  it('AC-Z15: execute mode (non-ideate) keeps slot-first behavior — does not regress F108', () => {
    // execute mode 下不走 ideate fallback，保留原 slot-first 语义（per F108）
    const active = deriveActiveAgents({
      targetAgents: ['opus-47', 'gpt-55'],
      snapshotAgents: [],
      hasActiveInvocation: true,
      activeInvocations: {
        // 47 完成清 slot，但 execute mode 不开 fallback
        'inv-2': { agentId: 'gpt-55', mode: 'execute' },
      },
      intentMode: 'execute',
    });

    expect(active).toEqual(['gpt-55']);
  });

  it('AC-Z15: ideate mode without intentMode param falls back to legacy slot-first behavior', () => {
    // 防呆：caller 没传 intentMode → 不开 ideate fallback (向后兼容)
    const active = deriveActiveAgents({
      targetAgents: ['opus-47', 'gpt-55'],
      snapshotAgents: [],
      hasActiveInvocation: true,
      activeInvocations: {
        'inv-2': { agentId: 'gpt-55', mode: 'ideate' },
      },
      // intentMode omitted
    });

    expect(active).toEqual(['gpt-55']);
  });
});
