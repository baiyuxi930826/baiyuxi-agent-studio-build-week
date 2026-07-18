/**
 * F054: Story Export - capability-channel review highlights.
 *
 * Each story card contains a title, optional subtitle, and messages rendered
 * with the same visual style as real ChatMessage bubbles.
 */

import { AGENT_COLORS } from '@/lib/color-defaults';

const STORY_USER_COLOR = { primary: '#2563EB', secondary: '#DBEAFE' } as const;

export type Speaker = 'opus' | 'codex' | 'gemini' | 'user';

export interface StoryMessage {
  speaker: Speaker;
  displayName?: string;
  content: string;
  thinking?: string;
  isWhisper?: boolean;
  badge?: { text: string; color: 'red' | 'green' | 'amber' | 'blue' };
  annotation?: string;
  reactions?: string[];
}

export interface StoryCard {
  title: string;
  subtitle?: string;
  messages: StoryMessage[];
}

export const AGENT_STYLES: Record<
  Speaker,
  {
    displayName: string;
    avatar: string;
    primary: string;
    secondary: string;
    bubbleRadius: string;
    font?: string;
  }
> = {
  opus: {
    displayName: 'Ethan（任务主控与实现）',
    avatar: '/avatars/default.svg',
    ...AGENT_COLORS.opus,
    bubbleRadius: 'rounded-2xl rounded-bl-sm',
  },
  codex: {
    displayName: 'Owen（验证与审查）',
    avatar: '/avatars/default.svg',
    ...AGENT_COLORS.codex,
    bubbleRadius: 'rounded-2xl rounded-br-sm',
    font: 'font-mono',
  },
  gemini: {
    displayName: 'Andy（界面与视觉）',
    avatar: '/avatars/default.svg',
    ...AGENT_COLORS.gemini,
    bubbleRadius: 'rounded-2xl rounded-tr-sm',
  },
  user: {
    displayName: 'Baiyuxi',
    avatar: '/avatars/default.svg',
    ...STORY_USER_COLOR,
    bubbleRadius: 'rounded-2xl rounded-br-sm',
  },
};

export const STORY_CARDS: StoryCard[] = [
  {
    title: '从想法到可执行计划',
    subtitle: 'Baiyuxi Agent Studio 的能力通道协作样例',
    messages: [
      {
        speaker: 'user',
        content: '我要把这个项目改成我的个人开发工作台。先别急着动代码，帮我拆成能验收的任务。',
        annotation: '需求入口',
      },
      {
        speaker: 'opus',
        content: '我会把任务拆成三条线：视觉系统、角色命名、公开归属。每条线都要有可验证的检查项，避免只改了首页文案。',
        badge: { text: '规划', color: 'blue' },
      },
      {
        speaker: 'codex',
        content:
          '验收建议：主界面不再出现旧品牌和宠物化称呼，运行时 catalog 使用能力通道，README 和贡献说明指向 Baiyuxi。',
        badge: { text: '验收', color: 'green' },
      },
    ],
  },
  {
    title: '角色命名收敛',
    subtitle: '从拟人昵称改为能力通道',
    messages: [
      {
        speaker: 'opus',
        content: 'Ethan（任务主控与实现） 负责方案边界、架构取舍和跨模块一致性。',
      },
      {
        speaker: 'codex',
        content: 'Owen（验证与审查） 负责缺陷、回归风险、安全边界和测试缺口。',
      },
      {
        speaker: 'gemini',
        content: 'Andy（界面与视觉） 负责界面节奏、视觉层级、交互状态和移动端适配。',
      },
      {
        speaker: 'user',
        content: '这样更像一组能力通道。保留模型能力差异，但不要再靠动物设定表达 Agent。',
        annotation: '用户决策',
      },
    ],
  },
  {
    title: '改版复盘',
    subtitle: '一次面向个人项目的前端风格替换',
    messages: [
      {
        speaker: 'gemini',
        content:
          '我把暖色、圆润、叙事化的界面语言改成冷静的工具台风格：蓝色主强调、低饱和中性色、紧凑导航和清晰状态层级。',
        badge: { text: '设计', color: 'blue' },
      },
      {
        speaker: 'codex',
        content:
          '我会继续扫公开 route、manifest、通知文案和导出页。内部字段例如 agentId 暂时保留，避免破坏运行时协议。',
        badge: { text: '风险控制', color: 'amber' },
      },
      {
        speaker: 'opus',
        content:
          '最终交付要通过 TypeScript、harness smoke 和浏览器检查。只要用户能打开应用，第一眼就应该看到 Baiyuxi 的 Agent 能力工作台。',
        badge: { text: '交付', color: 'green' },
      },
    ],
  },
];
