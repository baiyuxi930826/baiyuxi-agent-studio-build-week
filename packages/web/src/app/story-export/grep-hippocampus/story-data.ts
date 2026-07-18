/**
 * Story Export - recall debugging conversation data.
 */

import type { StoryCard } from '../story-data';

export const GREP_STORY_CARDS: StoryCard[] = [
  {
    title: '一次卡词问题',
    subtitle: '把人的记忆检索问题翻译成工程语言',
    messages: [
      {
        speaker: 'user',
        content: '我知道那个概念是什么，也知道它属于哪个系统，但准确词突然想不起来。你能不能用工程视角帮我拆一下？',
      },
      {
        speaker: 'codex',
        content:
          '这更像 lexical retrieval failure：概念命中了，标签没有弹出来。不是知识不存在，而是检索链路在最后一步超时。',
        badge: { text: '分析', color: 'blue' },
      },
    ],
  },
  {
    title: '从脑科学到调试模型',
    subtitle: 'Owen（验证与审查） 用检索系统类比解释现象',
    messages: [
      {
        speaker: 'codex',
        content: '可以把它近似看成三段流水线：语义召回命中，候选重排不稳定，最终 verbalizer 没有输出正确标签。',
      },
      {
        speaker: 'codex',
        content:
          '工程版日志可能是：concept alive，semantic neighborhood active，episodic cue partial，word label timeout。',
        badge: { text: '模型化', color: 'green' },
      },
      {
        speaker: 'user',
        content: '这个解释能用。它不把问题说成能力缺失，而是说成一个可观察的检索故障。',
      },
    ],
  },
  {
    title: '落地建议',
    subtitle: '把一次对话沉淀为可复用工作流',
    messages: [
      {
        speaker: 'opus',
        content: '以后遇到类似问题，先描述上级目录、排除项、功能线索和使用场景，再让 agent 帮你补候选标签。',
        badge: { text: '方法', color: 'amber' },
      },
      {
        speaker: 'codex',
        content: '这也是 Baiyuxi Agent Studio 的价值：把含糊经验转成可复用的工作流，再让不同角色继续补证据和验证。',
        badge: { text: '复用', color: 'green' },
      },
    ],
  },
];
