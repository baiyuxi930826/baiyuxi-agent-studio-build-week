/**
 * AgentRunner Native Provider — F159 Phase E: SSE Streaming + Agentic Loop
 *
 * Calls Anthropic Messages API directly with SSE streaming.
 * Phase E adds: per-token text streaming, streaming tool collection,
 * proper EOF validation. Strict streaming fail-closed — no non-streaming fallback.
 */

import type { AgentConfig, AgentId } from '@agent-studio/shared';
import { getAgentModel } from '../../../../../../config/agent-models.js';
import { createModuleLogger } from '../../../../../../infrastructure/logger.js';
import type { AgentMessage, AgentService, AgentServiceOptions, MessageMetadata, TokenUsage } from '../../../types.js';
import { mergeTokenUsage } from '../../../types.js';
import { resolveApiCredentials } from './agentrunner-credentials.js';
import type { AnthropicContentBlock, AnthropicToolUseBlock } from './agentrunner-event-bridge.js';
import { mapAnthropicError, mapAnthropicUsage, TERMINAL_STOP_REASONS } from './agentrunner-event-bridge.js';
import { buildToolRegistry, findTool, getToolSchemas } from './agentrunner-read-tools.js';
import type { AgentRunnerStreamEvent } from './agentrunner-stream-parser.js';
import { parseAnthropicSSE } from './agentrunner-stream-parser.js';
import { validateToolInput } from './agentrunner-tool-guard.js';
import type { AgentRunnerTool } from './agentrunner-tools.js';

const log = createModuleLogger('agentrunner');

const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MAX_TOKENS = 4096;
const MAX_TOOL_TURNS = 15;
const TOOL_RESULT_DIGEST_LIMIT = 500;

interface AgentRunnerServiceOptions {
  agentId: AgentId;
  projectRoot: string;
  agentConfig: AgentConfig | null;
}

/** Per-turn result accumulated from stream events. */
interface TurnResult {
  contentBlocks: AnthropicContentBlock[];
  stopReason: string | null;
  turnUsage: TokenUsage;
  hadStreamError: boolean;
}

/**
 * F153 Phase J AC-J2 (R1 P2 fix): structured tool execution outcome.
 * `status` is set from the execution-edge branch, NOT from content-string
 * heuristics — so a successful tool legitimately returning "Error: 200 OK"
 * style content does not get mis-marked as `error` (KD-38 honesty).
 */
export interface AgentRunnerToolExecResult {
  id: string;
  name: string;
  content: string;
  status: 'ok' | 'error';
}

/**
 * Execute Anthropic tool_use blocks against the local tool registry.
 * Exported (vs the previous private method) so unit tests can verify the
 * status mapping without standing up the full streaming HTTP pipeline.
 *
 * Branches:
 * - unknown tool → `status: 'error'`, content prefixed with "Error: unknown tool"
 * - successful execution → `status: 'ok'` regardless of returned text content
 * - thrown error (schema validation, tool.execute reject) → `status: 'error'`
 */
export async function executeAgentRunnerTools(
  blocks: AnthropicToolUseBlock[],
  tools: AgentRunnerTool[],
): Promise<AgentRunnerToolExecResult[]> {
  const results: AgentRunnerToolExecResult[] = [];
  for (const block of blocks) {
    const tool = findTool(tools, block.name);
    if (!tool) {
      results.push({
        id: block.id,
        name: block.name,
        content: `Error: unknown tool "${block.name}"`,
        status: 'error',
      });
      continue;
    }
    try {
      validateToolInput(tool.schema, block.input);
      const output = await tool.execute(block.input);
      // Status comes from the execution edge (no exception thrown), not from
      // content inspection — a tool may legitimately return text starting
      // with "Error:" (e.g. log/file content).
      results.push({ id: block.id, name: block.name, content: output, status: 'ok' });
    } catch (err: unknown) {
      results.push({
        id: block.id,
        name: block.name,
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        status: 'error',
      });
    }
  }
  return results;
}

export class AgentRunnerService implements AgentService {
  readonly agentId: AgentId;
  private readonly projectRoot: string;
  private readonly agentConfig: AgentConfig | null;

  constructor(options: AgentRunnerServiceOptions) {
    this.agentId = options.agentId;
    this.projectRoot = options.projectRoot;
    this.agentConfig = options.agentConfig;
  }

  async *invoke(prompt: string, options?: AgentServiceOptions): AsyncIterable<AgentMessage> {
    const now = Date.now();
    let model: string;
    try {
      model = getAgentModel(this.agentId as string);
    } catch {
      yield* emitError('Model resolution failed — no configured model', this.agentId, 'unknown', now);
      return;
    }
    const credentials = resolveApiCredentials(this.projectRoot, this.agentId as string, this.agentConfig);
    if (!credentials) {
      yield* emitError('Credential resolution failed — no bound account', this.agentId, model, now);
      return;
    }
    const sessionId = `agentrunner-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const metadata: MessageMetadata = { provider: 'agentrunner', model, sessionId };
    yield { type: 'session_init', agentId: this.agentId, sessionId, metadata, timestamp: now };
    yield* this.agenticLoop(prompt, model, metadata, credentials, options);
  }

  /** Agentic loop: stream API → yield text deltas → execute tools → repeat. */
  private async *agenticLoop(
    prompt: string,
    model: string,
    metadata: MessageMetadata,
    credentials: { apiKey: string; baseURL?: string },
    options?: AgentServiceOptions,
  ): AsyncIterable<AgentMessage> {
    const workDir = options?.workingDirectory;
    const tools = workDir ? await buildToolRegistry(workDir) : [];
    const toolSchemas = getToolSchemas(tools);
    const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: prompt }];
    let totalUsage: TokenUsage | undefined;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      let resp: Response;
      try {
        resp = await this.fetchApi(messages, toolSchemas, model, credentials, options);
      } catch (err: unknown) {
        yield* this.handleFetchError(err, metadata, model, totalUsage);
        return;
      }

      const result = yield* this.consumeTurn(resp, metadata, options?.signal);
      totalUsage = mergeTokenUsage(totalUsage, result.turnUsage);

      if (result.hadStreamError) {
        const orphanTools = result.contentBlocks.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');
        for (const t of orphanTools) {
          // F153 Phase J AC-J2: carry native tool_use_id + structured error status.
          yield {
            type: 'tool_result',
            agentId: this.agentId,
            content: 'Error: stream interrupted before tool execution',
            toolName: t.name,
            toolUseId: t.id,
            toolResultStatus: 'error',
            metadata,
            timestamp: Date.now(),
          };
        }
        yield* emitDone(this.agentId, metadata, totalUsage);
        return;
      }

      const isTerminal = result.stopReason != null && TERMINAL_STOP_REASONS.has(result.stopReason);
      if (isTerminal) {
        yield {
          type: 'done',
          agentId: this.agentId,
          metadata: { ...metadata, usage: totalUsage },
          timestamp: Date.now(),
        };
        return;
      }

      const toolBlocks = result.contentBlocks.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');
      if (toolBlocks.length === 0) {
        const reason = result.stopReason ?? 'unknown';
        log.warn(`[${this.agentId}] Non-terminal stop_reason "${reason}" with no tool calls`);
        yield {
          type: 'error',
          agentId: this.agentId,
          error: `Unexpected non-terminal response (stop_reason: ${reason}) with no tool calls`,
          metadata,
          timestamp: Date.now(),
        };
        yield* emitDone(this.agentId, metadata, totalUsage);
        return;
      }

      // Execute tools and build next turn
      const toolResults = await this.executeTools(toolBlocks, tools, metadata);
      for (const r of toolResults) {
        // F153 Phase J AC-J2 (R1 P2 fix): status comes from executeTools execution
        // edge — not from content inspection. A tool legitimately returning text
        // starting with "Error:" is still `ok` per KD-38 honesty.
        yield {
          type: 'tool_result',
          agentId: this.agentId,
          content: r.content.slice(0, TOOL_RESULT_DIGEST_LIMIT),
          toolName: r.name,
          toolUseId: r.id,
          toolResultStatus: r.status,
          metadata,
          timestamp: Date.now(),
        };
      }
      messages.push({ role: 'assistant', content: result.contentBlocks });
      messages.push({
        role: 'user',
        content: toolResults.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })),
      });
    }

    log.warn(`[${this.agentId}] Tool loop exceeded ${MAX_TOOL_TURNS} turns`);
    yield {
      type: 'error',
      agentId: this.agentId,
      error: `Tool loop exceeded ${MAX_TOOL_TURNS} turns`,
      metadata,
      timestamp: Date.now(),
    };
    yield* emitDone(this.agentId, metadata, totalUsage);
  }

  /** Consume one streaming turn, yielding text deltas and tool_use events. */
  private async *consumeTurn(
    resp: Response,
    metadata: MessageMetadata,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentMessage, TurnResult> {
    const contentBlocks: AnthropicContentBlock[] = [];
    const blocksByIndex = new Map<number, AnthropicContentBlock>();
    let stopReason: string | null = null;
    let inputUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let outputTokens = 0;
    let hadStreamError = false;

    if (!resp.body) {
      yield { type: 'error', agentId: this.agentId, error: 'Response has no body', metadata, timestamp: Date.now() };
      return { contentBlocks, stopReason, turnUsage: inputUsage, hadStreamError: true };
    }

    for await (const evt of parseAnthropicSSE(resp.body, signal)) {
      yield* this.mapStreamEvent(evt, metadata, blocksByIndex);

      if (evt.type === 'usage_update') {
        if (evt.inputUsage) inputUsage = mapAnthropicUsage(evt.inputUsage);
        if (evt.outputTokens !== undefined) outputTokens = evt.outputTokens;
      } else if (evt.type === 'stop') {
        stopReason = evt.stopReason;
      } else if (evt.type === 'stream_error') {
        hadStreamError = true;
      }
    }

    // Rebuild content blocks sorted by index (P1: preserve full assistant content)
    const sortedIndices = [...blocksByIndex.keys()].sort((a, b) => a - b);
    for (const idx of sortedIndices) contentBlocks.push(blocksByIndex.get(idx)!);

    const turnUsage: TokenUsage = { ...inputUsage, outputTokens };
    return { contentBlocks, stopReason, turnUsage, hadStreamError };
  }

  /** Map a single stream event to AgentMessage(s). */
  private *mapStreamEvent(
    evt: AgentRunnerStreamEvent,
    metadata: MessageMetadata,
    blocksByIndex: Map<number, AnthropicContentBlock>,
  ): Iterable<AgentMessage> {
    if (evt.type === 'text_delta') {
      yield { type: 'text', agentId: this.agentId, content: evt.text, metadata, timestamp: Date.now() };
    } else if (evt.type === 'content_block_complete') {
      blocksByIndex.set(evt.blockIndex, evt.block);
      if (evt.block.type === 'tool_use') {
        // F153 Phase J AC-J2: carry native Anthropic tool_use.id (from stream parser).
        yield {
          type: 'tool_use',
          agentId: this.agentId,
          toolName: evt.block.name,
          toolInput: evt.block.input,
          toolUseId: evt.block.id,
          metadata,
          timestamp: Date.now(),
        };
      }
    } else if (evt.type === 'stream_error') {
      yield { type: 'error', agentId: this.agentId, error: evt.error, metadata, timestamp: Date.now() };
    }
  }

  private async fetchApi(
    messages: Array<{ role: string; content: unknown }>,
    tools: Array<{ name: string; description: string; input_schema: unknown }>,
    model: string,
    credentials: { apiKey: string; baseURL?: string },
    options?: AgentServiceOptions,
  ): Promise<Response> {
    const url = `${(credentials.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/messages`;
    const body: Record<string, unknown> = { model, max_tokens: DEFAULT_MAX_TOKENS, messages, stream: true };
    if (tools.length > 0) body.tools = tools;
    if (options?.systemPrompt) body.system = options.systemPrompt;

    log.info(`[${this.agentId}] API call: model=${model}, turns=${messages.length}, stream=true`);
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': credentials.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown error');
      throw Object.assign(new Error(text), { httpStatus: resp.status });
    }
    return resp;
  }

  private executeTools(
    blocks: AnthropicToolUseBlock[],
    tools: AgentRunnerTool[],
    _metadata: MessageMetadata,
  ): Promise<AgentRunnerToolExecResult[]> {
    return executeAgentRunnerTools(blocks, tools);
  }

  private *handleFetchError(
    err: unknown,
    metadata: MessageMetadata,
    model: string,
    totalUsage: TokenUsage | undefined,
  ): Iterable<AgentMessage> {
    if (err instanceof DOMException && err.name === 'AbortError') {
      log.info(`[${this.agentId}] Request aborted`);
      yield { type: 'error', agentId: this.agentId, error: 'Request aborted', metadata, timestamp: Date.now() };
      yield* emitDone(this.agentId, metadata, totalUsage);
      return;
    }
    const httpStatus = (err as { httpStatus?: number }).httpStatus;
    const message = err instanceof Error ? err.message : String(err);
    if (httpStatus) {
      log.warn(`[${this.agentId}] API error ${httpStatus}: ${message.slice(0, 200)}`);
    } else {
      log.error(`[${this.agentId}] Unexpected error: ${message}`);
    }
    for (const msg of mapAnthropicError({ status: httpStatus ?? 0, message }, this.agentId, 'agentrunner', model)) {
      const usage = totalUsage ?? msg.metadata?.usage;
      yield { ...msg, metadata: { ...metadata, ...msg.metadata, usage } };
    }
  }
}

function emitError(message: string, agentId: AgentId, model: string, timestamp: number): AgentMessage[] {
  const metadata: MessageMetadata = { provider: 'agentrunner', model };
  return [
    { type: 'error', agentId, error: message, metadata, timestamp },
    { type: 'done', agentId, metadata: { ...metadata, usage: { inputTokens: 0, outputTokens: 0 } }, timestamp },
  ];
}

function* emitDone(
  agentId: AgentId,
  metadata: MessageMetadata,
  totalUsage: TokenUsage | undefined,
): Iterable<AgentMessage> {
  yield {
    type: 'done',
    agentId,
    metadata: { ...metadata, usage: totalUsage ?? { inputTokens: 0, outputTokens: 0 } },
    timestamp: Date.now(),
  };
}
