import { describe, expect, it } from 'vitest';

describe('transcription-corrector alias source', () => {
  it('picks up mention aliases after refreshSpeechAliases()', async () => {
    const { correctTranscription, refreshSpeechAliases } = await import('@/utils/transcription-corrector');
    // Before refresh: no aliases → no correction
    expect(correctTranscription('at测试Owen别名 出来一下')).toBe('at测试Owen别名 出来一下');

    // After refresh with dynamic agent data → corrects
    refreshSpeechAliases([{ mentionPatterns: ['@测试Owen别名', '@codex'] }]);
    expect(correctTranscription('at测试Owen别名 出来一下')).toBe('@测试Owen别名 出来一下');
  });
});
