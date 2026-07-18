import type { AgentId } from '@agent-studio/shared';
import type { AgentMessage } from '../../types.js';
import { normalizeTaskStatus } from '../invocation/invoke-helpers.js';

// F060: Allowed image MIME types and max base64 payload size (5 MB encoded ≈ 3.75 MB decoded)
const IMAGE_MIME_WHITELIST = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const MAX_BASE64_LENGTH = 5 * 1024 * 1024;

/**
 * Mutable state for tracking Codex multi-turn text separation.
 * Each `item.completed` with `agent_message` is a complete turn;
 * without explicit separation, consecutive turns get concatenated
 * without paragraph breaks (unlike Claude's incremental deltas which
 * naturally include the model's own whitespace).
 */
export interface CodexStreamState {
  hadPriorTextTurn: boolean;
  emittedTextByItemId?: Map<string, string>;
}

const UNKEYED_AGENT_MESSAGE_ID = '__codex_unkeyed_agent_message__';

function getTextState(state: CodexStreamState): Map<string, string> {
  if (!state.emittedTextByItemId) {
    state.emittedTextByItemId = new Map();
  }
  return state.emittedTextByItemId;
}

function getCodexItemId(item: Record<string, unknown> | undefined): string {
  const id = item?.id;
  return typeof id === 'string' && id.length > 0 ? id : UNKEYED_AGENT_MESSAGE_ID;
}

function longestPrefixSuffixOverlap(previous: string, next: string): number {
  const max = Math.min(previous.length, next.length);
  for (let len = max; len > 0; len--) {
    if (previous.endsWith(next.slice(0, len))) return len;
  }
  return 0;
}

function emitAgentTextSnapshot(
  item: Record<string, unknown> | undefined,
  text: string,
  agentId: AgentId,
  state?: CodexStreamState,
): AgentMessage | null {
  if (text.trim().length === 0) return null;

  if (!state) {
    return {
      type: 'text',
      agentId,
      content: text,
      timestamp: Date.now(),
    };
  }

  const emittedByItemId = getTextState(state);
  const itemId = getCodexItemId(item);
  let previous = emittedByItemId.get(itemId) ?? '';

  // Some streaming transports send anonymous text deltas first and then a keyed
  // final item.completed snapshot. Fold the anonymous prefix into the keyed
  // item so the final snapshot does not duplicate already streamed text.
  if (!previous && itemId !== UNKEYED_AGENT_MESSAGE_ID) {
    const unkeyed = emittedByItemId.get(UNKEYED_AGENT_MESSAGE_ID) ?? '';
    if (unkeyed && text.startsWith(unkeyed)) {
      previous = unkeyed;
      emittedByItemId.delete(UNKEYED_AGENT_MESSAGE_ID);
    }
  }

  if (previous === text) return null;

  const delta = text.startsWith(previous)
    ? text.slice(previous.length)
    : text.slice(longestPrefixSuffixOverlap(previous, text));
  if (delta.length === 0) {
    emittedByItemId.set(itemId, text);
    return null;
  }

  const prefix = previous.length === 0 && state.hadPriorTextTurn ? '\n\n' : '';
  emittedByItemId.set(itemId, text);
  state.hadPriorTextTurn = true;
  return {
    type: 'text',
    agentId,
    content: prefix + delta,
    textMode: 'append',
    timestamp: Date.now(),
  };
}

function emitAgentTextDelta(
  delta: string,
  agentId: AgentId,
  state?: CodexStreamState,
  itemId = UNKEYED_AGENT_MESSAGE_ID,
): AgentMessage | null {
  if (delta.length === 0) return null;

  if (!state) {
    return {
      type: 'text',
      agentId,
      content: delta,
      textMode: 'append',
      timestamp: Date.now(),
    };
  }

  const emittedByItemId = getTextState(state);
  const previous = emittedByItemId.get(itemId) ?? '';
  const prefix = previous.length === 0 && state.hadPriorTextTurn ? '\n\n' : '';
  emittedByItemId.set(itemId, previous + delta);
  state.hadPriorTextTurn = true;

  return {
    type: 'text',
    agentId,
    content: prefix + delta,
    textMode: 'append',
    timestamp: Date.now(),
  };
}

function extractOpenAiTextDelta(event: Record<string, unknown>): { text: string; itemId?: string } | null {
  const type = event.type;
  if (
    type !== 'response.output_text.delta' &&
    type !== 'response.output_text.delta_event' &&
    type !== 'agent_message_delta'
  ) {
    return null;
  }

  const rawDelta = event.delta ?? event.text;
  if (typeof rawDelta !== 'string' || rawDelta.length === 0) return null;

  const rawItemId = event.item_id ?? event.itemId ?? event.output_index;
  return {
    text: rawDelta,
    ...(typeof rawItemId === 'string' || typeof rawItemId === 'number'
      ? { itemId: `openai:${String(rawItemId)}` }
      : {}),
  };
}

/**
 * Transform a raw Codex CLI NDJSON event into an AgentMessage.
 * Returns null to skip events we don't care about.
 *
 * When `state` is provided, consecutive agent_message text turns are
 * separated by `\n\n` to preserve paragraph breaks between turns.
 */
export function transformCodexEvent(
  event: unknown,
  agentId: AgentId,
  state?: CodexStreamState,
): AgentMessage | AgentMessage[] | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as Record<string, unknown>;

  if (e.type === 'thread.started') {
    const threadId = e.thread_id;
    if (typeof threadId !== 'string') return null;
    return {
      type: 'session_init',
      agentId,
      sessionId: threadId,
      timestamp: Date.now(),
    };
  }

  // F045: todo_list (started/updated/completed) → system_info(task_progress)
  // Checked BEFORE item.started/item.completed type guards below
  const isTodoList =
    (e.type === 'item.started' || e.type === 'item.updated' || e.type === 'item.completed') &&
    (e.item as Record<string, unknown> | undefined)?.type === 'todo_list';
  if (isTodoList) {
    const todoItem = e.item as Record<string, unknown>;
    const rawItems = Array.isArray(todoItem.todo_items)
      ? (todoItem.todo_items as Array<Record<string, unknown>>)
      : Array.isArray(todoItem.items)
        ? (todoItem.items as Array<Record<string, unknown>>)
        : [];
    const tasks = rawItems.map((t, i) => {
      const subject = typeof t.content === 'string' ? t.content : typeof t.text === 'string' ? t.text : '';
      const rawStatus =
        typeof t.status === 'string'
          ? t.status
          : typeof t.completed === 'boolean'
            ? t.completed
              ? 'completed'
              : 'pending'
            : 'pending';
      return {
        id: typeof t.id === 'string' ? t.id : `task-${i}`,
        subject: subject.slice(0, 120),
        status: normalizeTaskStatus(rawStatus),
      };
    });
    return {
      type: 'system_info',
      agentId,
      content: JSON.stringify({ type: 'task_progress', agentId, action: 'snapshot', tasks }),
      timestamp: Date.now(),
    };
  }

  const textDelta = extractOpenAiTextDelta(e);
  if (textDelta) {
    return emitAgentTextDelta(textDelta.text, agentId, state, textDelta.itemId);
  }

  if (e.type === 'item.updated') {
    const item = e.item as Record<string, unknown> | undefined;
    if (item?.type === 'agent_message' && typeof item.text === 'string') {
      return emitAgentTextSnapshot(item, item.text, agentId, state);
    }
  }

  if (e.type === 'item.started') {
    const item = e.item as Record<string, unknown> | undefined;

    // F045: mcp_tool_call started → tool_use
    if (item?.type === 'mcp_tool_call') {
      const server = typeof item.server === 'string' ? item.server : 'unknown';
      const tool = typeof item.tool === 'string' ? item.tool : 'unknown';
      const args =
        typeof item.arguments === 'object' && item.arguments !== null
          ? (item.arguments as Record<string, unknown>)
          : {};
      // F153 Phase J AC-J2: Codex uses item.id as the lifecycle anchor (no tool_call_id field).
      const msg: AgentMessage = {
        type: 'tool_use',
        agentId,
        toolName: `mcp:${server}/${tool}`,
        toolInput: args,
        timestamp: Date.now(),
      };
      if (typeof item.id === 'string') msg.toolUseId = item.id;
      return msg;
    }

    if (item?.type !== 'command_execution') return null;
    const command = item.command;
    if (typeof command !== 'string') return null;
    return {
      type: 'tool_use',
      agentId,
      toolName: 'command_execution',
      toolInput: { command },
      timestamp: Date.now(),
    };
  }

  if (e.type === 'error') {
    const message = e.message;
    if (typeof message !== 'string') return null;
    const text = message.trim();
    // Reconnecting… lines stream to UI as progress
    if (text.startsWith('Reconnecting...'))
      return { type: 'system_info', agentId, content: text, timestamp: Date.now() };
    // Non-Reconnecting errors: return null — CodexAgentService collects them via
    // collectCodexStreamError() and surfaces them as diagnostics in the exit error.
    return null;
  }

  if (e.type !== 'item.completed') return null;

  const item = e.item as Record<string, unknown> | undefined;

  if (item?.type === 'agent_message' && typeof item.text === 'string') {
    return emitAgentTextSnapshot(item, item.text, agentId, state);
  }

  if (item?.type === 'command_execution') {
    const command = typeof item.command === 'string' ? item.command : '';
    const status = typeof item.status === 'string' ? item.status : 'completed';
    const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null;
    const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';

    const sections: string[] = [];
    if (command) sections.push(`command: ${command}`);
    sections.push(`status: ${status}`);
    if (exitCode !== null) sections.push(`exit_code: ${exitCode}`);
    const trimmedOutput = output.trimEnd();
    if (trimmedOutput) sections.push(trimmedOutput);

    return {
      type: 'tool_result',
      agentId,
      content: sections.join('\n'),
      timestamp: Date.now(),
    };
  }

  if (item?.type === 'file_change') {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const status = typeof item.status === 'string' ? item.status : 'completed';
    return {
      type: 'tool_use',
      agentId,
      toolName: 'file_change',
      toolInput: { status, changes: changes.length },
      timestamp: Date.now(),
    };
  }

  // F045: mcp_tool_call completed → tool_result (+ F060: optional rich_block for images)
  if (item?.type === 'mcp_tool_call') {
    const server = typeof item.server === 'string' ? item.server : 'unknown';
    const tool = typeof item.tool === 'string' ? item.tool : 'unknown';
    const status = typeof item.status === 'string' ? item.status : 'completed';
    const result = item.result as Record<string, unknown> | undefined;
    const contentArr = Array.isArray(result?.content) ? result.content : [];
    const typed = contentArr as Array<Record<string, unknown>>;
    const textParts = typed.filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text as string);

    const toolLabel = `mcp:${server}/${tool}`;
    // F153 Phase J AC-J2: map Codex item.status → structured ToolResultStatus + carry item.id.
    const toolResultStatus: 'ok' | 'error' | 'unknown' =
      status === 'completed' ? 'ok' : status === 'failed' || status === 'error' ? 'error' : 'unknown';
    const toolResult: AgentMessage = {
      type: 'tool_result',
      agentId,
      content: `${toolLabel} (${status})\n${textParts.join('\n')}`.trim(),
      toolName: toolLabel,
      toolResultStatus,
      timestamp: Date.now(),
    };
    if (typeof item.id === 'string') toolResult.toolUseId = item.id;

    // F060: Extract image content blocks → media_gallery rich block
    // P2 fix: mimeType whitelist + base64 size guard
    const imageItems = typed
      .filter(
        (c) =>
          c.type === 'image' &&
          typeof c.data === 'string' &&
          typeof c.mimeType === 'string' &&
          IMAGE_MIME_WHITELIST.has(c.mimeType as string) &&
          (c.data as string).length <= MAX_BASE64_LENGTH,
      )
      .map((c) => ({
        url: `data:${c.mimeType as string};base64,${c.data as string}`,
        alt: 'MCP tool output image',
      }));

    if (imageItems.length === 0) {
      return toolResult;
    }

    const richBlock: AgentMessage = {
      type: 'system_info',
      agentId,
      content: JSON.stringify({
        type: 'rich_block',
        block: {
          id: `mcp-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'media_gallery',
          v: 1,
          title: toolLabel,
          items: imageItems,
        },
      }),
      timestamp: Date.now(),
    };

    return [toolResult, richBlock];
  }

  // F045: web_search → system_info — count only, no query (privacy)
  if (item?.type === 'web_search') {
    return {
      type: 'system_info',
      agentId,
      content: JSON.stringify({ type: 'web_search', agentId, count: 1 }),
      timestamp: Date.now(),
    };
  }

  // F045: reasoning → system_info(thinking)
  if (item?.type === 'reasoning' && typeof item.text === 'string' && item.text.length > 0) {
    return {
      type: 'system_info',
      agentId,
      content: JSON.stringify({ type: 'thinking', agentId, text: item.text }),
      timestamp: Date.now(),
    };
  }

  // F045: item-level error → system_info(warning)
  if (item?.type === 'error' && typeof item.message === 'string') {
    return {
      type: 'system_info',
      agentId,
      content: JSON.stringify({ type: 'warning', agentId, message: item.message }),
      timestamp: Date.now(),
    };
  }

  return null;
}
