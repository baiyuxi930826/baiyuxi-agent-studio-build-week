/**
 * ConnectorMessageFormatter — Platform-agnostic message envelope generator.
 *
 * Converts agent reply metadata into a unified MessageEnvelope structure.
 * Each platform adapter then converts the envelope to its native format
 * (Feishu interactive card, Telegram MarkdownV2, Slack Block Kit, etc.).
 *
 * This is the public layer — business logic lives here, adapters only render.
 *
 * F088 Multi-Platform Chat Gateway
 */

export type MessageOrigin = 'callback' | 'agent' | 'system';

export interface CardAction {
  readonly label: string;
  readonly value: Record<string, unknown>;
}

export const DEFAULT_QUICK_ACTIONS: readonly CardAction[] = [
  { label: '➕ 新建', value: { cmd: '/new' } },
  { label: '📋 选择会话', value: { cmd: '/threads' } },
  { label: '📜 历史', value: { cmd: '/history', args: 'pick' } },
  { label: '❓ 帮助', value: { cmd: '/commands' } },
];

export interface MessageEnvelope {
  /** Agent identity line, e.g. "Ethan（任务主控与实现）" */
  readonly header: string;
  /** Thread context, e.g. "T12 飞书登录bug排查 · F088" */
  readonly subtitle: string;
  /** Message body (markdown supported) */
  readonly body: string;
  /** Deep link + timestamp, e.g. "📎 在前端查看 · 01:22" */
  readonly footer: string;
  /** Where this message originated from — adapters can render differently */
  readonly origin?: MessageOrigin | undefined;
  /** Optional action buttons rendered as card actions (Feishu buttons, etc.) */
  readonly cardActions?: readonly CardAction[] | undefined;
}

export interface FormatInput {
  readonly agentDisplayName: string;
  readonly agentBadge: string;
  readonly threadShortId: string;
  readonly threadTitle?: string | undefined;
  readonly featId?: string | undefined;
  readonly body: string;
  readonly deepLinkUrl?: string | undefined;
  readonly timestamp: Date;
  readonly origin?: MessageOrigin | undefined;
}

export class ConnectorMessageFormatter {
  format(input: FormatInput): MessageEnvelope {
    const header = `${input.agentBadge} ${input.agentDisplayName}`;

    // Build subtitle: "T12 飞书登录bug排查 · F088"
    let subtitle = input.threadShortId;
    if (input.threadTitle) {
      subtitle += ` ${input.threadTitle}`;
    }
    if (input.featId) {
      subtitle += ` · ${input.featId}`;
    }

    // Build footer: "📎 在前端查看 · 01:22" or just "01:22"
    const timeStr = input.timestamp.toISOString().slice(11, 16); // HH:MM UTC
    let footer: string;
    if (input.deepLinkUrl) {
      footer = `📎 ${input.deepLinkUrl} · ${timeStr}`;
    } else {
      footer = timeStr;
    }

    return { header, subtitle, body: input.body, footer, origin: input.origin };
  }

  /**
   * Format a minimal envelope with agent identity only (no thread metadata).
   * Phase E: ensures every message is a distinct card even without threadMeta.
   */
  formatMinimal(input: {
    agentDisplayName: string;
    agentBadge: string;
    body: string;
    origin?: MessageOrigin;
  }): MessageEnvelope {
    return {
      header: `${input.agentBadge} ${input.agentDisplayName}`,
      subtitle: '',
      body: input.body,
      footer: new Date().toISOString().slice(11, 16),
      origin: input.origin,
    };
  }

  /** Format a system/command response (no agent identity, lightweight envelope). */
  formatCommand(body: string, cardActions?: readonly CardAction[]): MessageEnvelope {
    return {
      header: 'Baiyuxi Agent Studio',
      subtitle: '',
      body,
      footer: new Date().toISOString().slice(11, 16),
      cardActions,
    };
  }
}
