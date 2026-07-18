/**
 * F087: Predefined Interactive Rich Block configurations for bootcamp phases.
 * These are used by the bootcamp-guide skill to present selection UIs.
 */

export interface BootcampInteractiveBlock {
  id: string;
  kind: 'interactive';
  v: 1;
  interactiveType: 'card-grid' | 'select' | 'confirm';
  title: string;
  description?: string;
  options: Array<{
    id: string;
    label: string;
    emoji?: string;
    icon?: string;
    description?: string;
    level?: number;
    group?: string;
  }>;
  allowRandom?: boolean;
  messageTemplate?: string;
}

/** Phase 0: Agent selection — user picks their lead capability channel */
export const agentSelectionBlock: BootcampInteractiveBlock = {
  id: 'bootcamp-agent-select',
  kind: 'interactive',
  v: 1,
  interactiveType: 'card-grid',
  title: '选一个 Agent 能力通道当你的主引导！',
  description: '其他能力通道也会在需要时加入协作',
  options: [
    {
      id: 'opus',
      icon: 'architecture',
      label: 'Ethan（任务主控与实现）',
      description: '负责目标拆解、工作流编排、主要实现和集成验证',
      group: '选择你的引导通道',
    },
    {
      id: 'codex',
      icon: 'code',
      label: 'Owen（验证与审查）',
      description: '负责输出评估、风险检查、测试缺口和交付门禁',
      group: '选择你的引导通道',
    },
    {
      id: 'gemini',
      icon: 'palette',
      label: 'Andy（界面与视觉）',
      description: '负责界面风格、交互状态、视觉层级和浏览器验证',
      group: '选择你的引导通道',
    },
    {
      id: 'kimi',
      icon: 'search',
      label: 'Nora（研究与上下文）',
      description: '负责资料检索、事实核验、长上下文整理和方案素材',
      group: '选择你的引导通道',
    },
  ],
  allowRandom: true,
  messageTemplate: '我选 {selection} 当我的引导通道！',
};

/** Phase 4: Task selection — user picks a bootcamp project */
export const taskSelectionBlock: BootcampInteractiveBlock = {
  id: 'bootcamp-task-select',
  kind: 'interactive',
  v: 1,
  interactiveType: 'card-grid',
  title: '选一个你感兴趣的项目，我们一起做！',
  description: '按难度分层，选适合你的，或者让命运来决定',
  allowRandom: true,
  options: [
    // Lv.1 — 好玩上手
    {
      id: 'Q1',
      icon: 'dice',
      label: 'Agent 能力通道卡',
      description: '每日随机协作通道 ~30min',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    {
      id: 'Q2',
      icon: 'star',
      label: '通道协作风格',
      description: '四通道协作建议 ~30min',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    {
      id: 'Q3',
      icon: 'search',
      label: 'Debug 侦探组',
      description: '游戏化 debug ~1h',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    { id: 'Q4', icon: 'chat', label: '心情墙', description: '情绪价值拉满 ~1h', level: 1, group: 'Lv.1 好玩上手' },
    {
      id: 'Q5',
      icon: 'palette',
      label: 'Emoji 工坊',
      description: '跨智能体创作 ~1h',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    {
      id: 'Q6',
      icon: 'workspace',
      label: '工作流配方',
      description: '开发节奏模板 ~1h',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    {
      id: 'Q7',
      icon: 'utensils',
      label: '需求点单',
      description: '全栈点餐系统 ~2h',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    {
      id: 'Q8',
      icon: 'game',
      label: '像素协作场景',
      description: '像素互动场景 ~2h',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    {
      id: 'Q9',
      icon: 'chart',
      label: '3D 能力看板',
      description: 'Agent 能力雷达图 ~2h',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    {
      id: 'Q10',
      icon: 'heart',
      label: 'Agent 互动工具',
      description: '逗智能体棒+摸头 ~1h',
      level: 1,
      group: 'Lv.1 好玩上手',
    },
    // Lv.2 — 有深度
    {
      id: 'Q11',
      icon: 'sun',
      label: 'Agent 天气站',
      description: 'API + 多 Agent 播报 ~2h',
      level: 2,
      group: 'Lv.2 有深度',
    },
    { id: 'Q12', icon: 'test', label: 'Standup 面板', description: '协作可观测性 ~2h', level: 2, group: 'Lv.2 有深度' },
    { id: 'Q13', icon: 'trophy', label: '成就博物馆', description: 'Git 数据挖掘 ~3h', level: 2, group: 'Lv.2 有深度' },
    { id: 'Q14', icon: 'globe', label: 'Agent 翻译官', description: '多风格翻译 ~2h', level: 2, group: 'Lv.2 有深度' },
    // Lv.3 — 进阶挑战
    { id: 'Q15', icon: 'scale', label: '决策室', description: 'Agent 方案评审 ~3h', level: 3, group: 'Lv.3 进阶挑战' },
    { id: 'Q16', icon: 'shuffle', label: '代码接力', description: '全流程协作 ~4h', level: 3, group: 'Lv.3 进阶挑战' },
  ],
  messageTemplate: '我选了 {selection}！',
};

/** Get all bootcamp block definitions by ID */
export const BOOTCAMP_BLOCKS: Record<string, BootcampInteractiveBlock> = {
  'bootcamp-agent-select': agentSelectionBlock,
  'bootcamp-task-select': taskSelectionBlock,
};
