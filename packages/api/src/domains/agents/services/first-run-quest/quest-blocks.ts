/**
 * F171: Interactive block definitions for First-Run Quest.
 * These are sent to the frontend as rich blocks for the gamified UI.
 */

export interface QuestTemplateCard {
  id: string;
  name: string;
  nickname: string;
  avatar: string;
  color: { primary: string; secondary: string };
  roleDescription: string;
  personality: string;
  teamStrengths: string;
}

/** Curated subset of F087 tasks suitable for first-run (high success + visible output). */
export const QUEST_TASKS = [
  {
    id: 'FRQ-1',
    icon: '🎲',
    label: 'Agent 能力通道卡',
    description: '每天随机介绍一个能力通道，含适用场景和协作建议 (~5分钟)',
    difficulty: 1,
  },
  {
    id: 'FRQ-2',
    icon: '🌤️',
    label: '天气小卡片',
    description: '生成一个简单的天气展示组件 (~5分钟)',
    difficulty: 1,
  },
  {
    id: 'FRQ-3',
    icon: '📝',
    label: 'Hello Agent Studio',
    description: '创建一个欢迎页面，展示你的 Agent 能力通道 (~3分钟)',
    difficulty: 1,
  },
] as const;

export type QuestTaskId = (typeof QUEST_TASKS)[number]['id'];

/**
 * Build the task selection interactive block for the quest.
 */
export function buildQuestTaskSelectionBlock(questThreadId: string) {
  return {
    id: `quest-task-select-${questThreadId}`,
    kind: 'interactive' as const,
    v: 1 as const,
    interactiveType: 'card-grid' as const,
    title: '选择你的首个任务',
    description: '挑一个简单的任务，让你的 Agent 能力通道大展身手！',
    options: QUEST_TASKS.map((task) => ({
      id: task.id,
      label: task.label,
      emoji: task.icon,
      description: task.description,
      level: task.difficulty,
    })),
    allowRandom: true,
    messageTemplate: '我选择了 {selection}！',
  };
}

/**
 * Build the "error encountered" prompt block.
 */
export function buildErrorEncounteredBlock(agentName: string) {
  return {
    id: `quest-error-encountered-${Date.now()}`,
    kind: 'interactive' as const,
    v: 1 as const,
    interactiveType: 'confirm' as const,
    title: `${agentName} 好像遇到了一点问题...`,
    description: '单一路径容易漏问题。要不要再加入一个能力通道做验证和补位？',
    options: [
      { id: 'add-second-agent', label: '好！再加一个 Agent', emoji: '🛠️' },
      { id: 'skip', label: '先跳过', emoji: '⏭️' },
    ],
  };
}

/**
 * Build the collaboration demo auto-fill suggestion.
 */
export function buildCollaborationPrompt(secondAgentName: string, firstAgentName: string) {
  return `@${secondAgentName} 你来帮忙看看 ${firstAgentName} 刚才写的代码，有没有问题？`;
}

/**
 * Build the completion celebration block.
 */
export function buildCompletionBlock() {
  return {
    id: `quest-completion-${Date.now()}`,
    kind: 'card' as const,
    v: 1 as const,
    title: '恭喜！你已经掌握了多 Agent 协作的基本技能',
    description: [
      '你学会了：',
      '- 从模板创建 Agent 能力通道',
      '- 用 @mention 指派任务',
      '- 让多个 Agent 能力通道协作和互相监督',
      '',
      '前往 Console 可以添加更多 Agent、修改配置，打造你的专属能力通道工作台！',
    ].join('\n'),
    actions: [
      { id: 'go-console', label: '前往 Console', url: '/hub' },
      { id: 'dismiss', label: '知道了' },
    ],
  };
}
