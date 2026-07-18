import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTermDictionary,
  correctTranscription,
  refreshSpeechAliases,
  removeFillers,
} from '@/utils/transcription-corrector';

/* ------------------------------------------------------------------ */
/*  applyTermDictionary                                                */
/* ------------------------------------------------------------------ */

describe('applyTermDictionary', () => {
  it('replaces a single known term', () => {
    expect(applyTermDictionary('用 icp 协议')).toBe('用 MCP 协议');
  });

  it('is case-insensitive', () => {
    expect(applyTermDictionary('ICP server')).toBe('MCP server');
    expect(applyTermDictionary('Icp server')).toBe('MCP server');
  });

  it('replaces Chinese misrecognitions', () => {
    expect(applyTermDictionary('法式的很快')).toBe('Fastify很快');
    expect(applyTermDictionary('锐的死连接')).toBe('Redis连接');
    expect(applyTermDictionary('瑞迪斯连接')).toBe('Redis连接');
  });

  it('handles multiple terms in one string', () => {
    const input = '用 icp 和 type script 开发';
    expect(applyTermDictionary(input)).toBe('用 MCP 和 TypeScript 开发');
  });

  it('leaves unknown words unchanged', () => {
    const input = '这是一段正常的文字';
    expect(applyTermDictionary(input)).toBe(input);
  });

  it('returns empty string unchanged', () => {
    expect(applyTermDictionary('')).toBe('');
  });

  it('replaces all original dictionary entries correctly', () => {
    expect(applyTermDictionary('为的')).toBe('void');
    expect(applyTermDictionary('那的js')).toBe('Node.js');
    expect(applyTermDictionary('组单的')).toBe('Zustand');
    expect(applyTermDictionary('威士伯')).toBe('Whisper');
    expect(applyTermDictionary('work tree')).toBe('worktree');
    expect(applyTermDictionary('re base')).toBe('rebase');
  });

  it('corrects agent names (proven misrecognitions)', () => {
    expect(applyTermDictionary('欧文帮我review')).toBe('Owen（验证与审查）帮我review');
    expect(applyTermDictionary('偶文说')).toBe('Owen（验证与审查）说');
    expect(applyTermDictionary('安迪智能体')).toBe('Andy（界面与视觉）智能体');
    expect(applyTermDictionary('安蒂看一下')).toBe('Andy（界面与视觉）看一下');
    expect(applyTermDictionary('伊森智能体')).toBe('Ethan（任务主控与实现）智能体');
    expect(applyTermDictionary('诺拉整理资料')).toBe('Nora（研究与上下文）整理资料');
    expect(applyTermDictionary('项目负责人')).toBe('Owner');
  });

  it('corrects English-name homophones for Owen variants', () => {
    expect(applyTermDictionary('欧闻帮我看')).toBe('Owen（验证与审查）帮我看');
    expect(applyTermDictionary('偶文出来')).toBe('Owen（验证与审查）出来');
    expect(applyTermDictionary('欧文 review')).toBe('Owen（验证与审查） review');
  });

  it('corrects capability-channel aliases', () => {
    expect(applyTermDictionary('主控实现你看')).toBe('Ethan（任务主控与实现）你看');
    expect(applyTermDictionary('验证审查')).toBe('Owen（验证与审查）');
    expect(applyTermDictionary('界面视觉帮忙')).toBe('Andy（界面与视觉）帮忙');
    expect(applyTermDictionary('研究上下文')).toBe('Nora（研究与上下文）');
  });

  it('corrects AI model and brand names', () => {
    expect(applyTermDictionary('克劳德很聪明')).toBe('Claude很聪明');
    expect(applyTermDictionary('科德斯 review')).toBe('Codex review');
    expect(applyTermDictionary('奥普斯模型')).toBe('Opus模型');
    expect(applyTermDictionary('杰米尼')).toBe('Gemini');
    expect(applyTermDictionary('桑奈特')).toBe('Sonnet');
    expect(applyTermDictionary('海酷')).toBe('Haiku');
    expect(applyTermDictionary('安索皮克')).toBe('Anthropic');
  });

  it('corrects framework and tool names', () => {
    expect(applyTermDictionary('泰尔温样式')).toBe('Tailwind样式');
    expect(applyTermDictionary('优维康服务')).toBe('uvicorn服务');
    expect(applyTermDictionary('fast api接口')).toBe('FastAPI接口');
    expect(applyTermDictionary('web socket连接')).toBe('WebSocket连接');
    expect(applyTermDictionary('亨德赛特记忆')).toBe('Hindsight记忆');
  });
});

/* ------------------------------------------------------------------ */
/*  removeFillers                                                      */
/* ------------------------------------------------------------------ */

describe('removeFillers', () => {
  it('removes a single filler word', () => {
    expect(removeFillers('嗯我想问一下')).toBe('我想问一下');
  });

  it('removes filler at end of string', () => {
    expect(removeFillers('看看这个啊')).toBe('看看这个');
  });

  it('removes filler between words', () => {
    expect(removeFillers('先那个看一下代码')).toBe('先 看一下代码');
  });

  it('removes multiple different fillers', () => {
    expect(removeFillers('嗯那个就是说帮我看看')).toBe('帮我看看');
  });

  it('removes consecutive identical fillers', () => {
    expect(removeFillers('嗯嗯嗯开始吧')).toBe('开始吧');
  });

  it('collapses resulting whitespace', () => {
    expect(removeFillers('先  嗯  看看')).toBe('先 看看');
  });

  it('preserves content without fillers', () => {
    const clean = '请帮我 review 这段代码';
    expect(removeFillers(clean)).toBe(clean);
  });

  it('returns empty string unchanged', () => {
    expect(removeFillers('')).toBe('');
  });

  it('handles string that is only fillers', () => {
    expect(removeFillers('嗯啊那个')).toBe('');
  });

  it('removes longer fillers before shorter ones', () => {
    // "就是说" should be removed as a whole, not leave "说"
    expect(removeFillers('就是说我觉得')).toBe('我觉得');
    // "就是" within "就是说" should already be consumed
    expect(removeFillers('就是我觉得')).toBe('我觉得');
  });

  it('removes 然后呢 and 对对对', () => {
    expect(removeFillers('然后呢我们继续')).toBe('我们继续');
    expect(removeFillers('对对对没错')).toBe('没错');
  });
});

/* ------------------------------------------------------------------ */
/*  correctTranscription (full pipeline)                               */
/* ------------------------------------------------------------------ */

describe('correctTranscription', () => {
  beforeEach(() => {
    refreshSpeechAliases([{ mentionPatterns: ['@owen', '@ethan'] }]);
  });

  it('applies both term replacement and filler removal', () => {
    const input = '嗯那个用 icp 和 type script 开发';
    expect(correctTranscription(input)).toBe('用 MCP 和 TypeScript 开发');
  });

  it('handles term replacement that would overlap fillers', () => {
    // Term replacement happens first, so fillers in the result
    // of replacement do not cause issues
    const input = '法式的很快啊';
    expect(correctTranscription(input)).toBe('Fastify很快');
  });

  it('returns empty string unchanged', () => {
    expect(correctTranscription('')).toBe('');
  });

  it('handles input with only fillers', () => {
    expect(correctTranscription('嗯啊那个就是')).toBe('');
  });

  it('handles realistic voice input', () => {
    const input = '嗯那个帮我看看 icp 的 work tree 配置啊就是 锐的死 连接有问题';
    const expected = '帮我看看 MCP 的 worktree 配置 Redis 连接有问题';
    expect(correctTranscription(input)).toBe(expected);
  });

  it('handles realistic voice input with agent names', () => {
    const input = '嗯让欧文帮我 review 一下那个克劳德的 web socket 代码';
    const expected = '让Owen（验证与审查）帮我 review 一下 Claude的 WebSocket 代码';
    expect(correctTranscription(input)).toBe(expected);
  });

  it('normalizes speech-style at-mentions for agent nicknames', () => {
    const input = 'at咱的owen 和 at ethan 你们出来了';
    const expected = '@owen 和 @ethan 你们出来了';
    expect(correctTranscription(input)).toBe(expected);
  });

  it('normalizes @。 + nickname style mentions', () => {
    const input = '@。owen 先看这个';
    const expected = '@owen 先看这个';
    expect(correctTranscription(input)).toBe(expected);
  });
});
