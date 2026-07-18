/**
 * Parallel Route Strategy
 * All agents respond independently to the same message.
 */

import type { AgentConfig, AgentId } from '@agent-studio/shared';
import { agentRegistry, resolveWorkflowSopSkill } from '@agent-studio/shared';
import { getAgentContextBudget } from '../../../../../config/agent-budgets.js';
import { getConfigSessionStrategy, isSessionChainEnabled } from '../../../../../config/agent-config-loader.js';
import { createModuleLogger } from '../../../../../infrastructure/logger.js';
import {
  ROUTE_HAS_A2A_HANDOFF,
  ROUTE_TOTAL_AGENTS_INVOKED,
  ROUTE_TOTAL_TOKENS,
} from '../../../../../infrastructure/telemetry/genai-semconv.js';
import { estimateTokens } from '../../../../../utils/token-counter.js';
import {
  conciergeContextForAgent,
  prepareConciergeContext,
} from '../../../../concierge/ConciergeRoutingInterceptor.js';
import {
  buildConciergeActions,
  extractTriagePlanIdsFromActions,
  stripTriagePlanMarkers,
  type TriagePlanExtractionDeps,
} from '../../../../concierge/concierge-reply-validator.js';
import { buildConciergeSearchContext } from '../../../../concierge/concierge-search-context.js';
import {
  ackGuideCompletion,
  guideContextForAgent,
  prepareGuideContext,
} from '../../../../guides/GuideRoutingInterceptor.js';
import { triggerRecallCorrelation } from '../../../../memory/recall-correlation-hook.js';
import { assembleContext } from '../../context/ContextAssembler.js';
import {
  buildInvocationContext,
  buildStaticIdentity,
  buildStaticIdentityPackOnly,
  type InvocationContext,
} from '../../context/SystemPromptBuilder.js';
import { formatDegradationMessage } from '../../orchestration/DegradationPolicy.js';
import { buildSessionBootstrap } from '../../session/SessionBootstrap.js';
import type { StoredToolEvent } from '../../stores/ports/MessageStore.js';
import type { Thread, ThreadRoutingPolicyV1 } from '../../stores/ports/ThreadStore.js';
import { classifyTool } from '../../tool-usage/classify.js';
import { deriveResultSummary } from '../../tool-usage/derive-result-summary.js';
import { normalizeMcpToolName } from '../../tool-usage/normalize-mcp-tool-name.js';
import { getVoiceBlockSynthesizer } from '../../tts/VoiceBlockSynthesizer.js';
import type { AgentMessage, AgentMessageType, MessageMetadata } from '../../types.js';
import { buildCapsuleFromRouteState } from '../invocation/CollaborationContinuityCapsule.js';
import { invokeSingleAgent } from '../invocation/invoke-single-agent.js';
import {
  buildMcpCallbackInstructions,
  isNativeMcpAvailable,
  needsMcpInjection,
} from '../invocation/McpPromptInjector.js';
import { getRichBlockBuffer } from '../invocation/RichBlockBuffer.js';
import { mergeStreams } from '../invocation/stream-merge.js';
import { resolveDefaultClaudeMcpServerPath } from '../providers/ClaudeAgentService.js';
import { parseA2AMentions } from '../routing/a2a-mentions.js';
import { accumulateTextAggregate } from '../text-aggregation.js';
import { type ContextEvalInput, extractContextEvalSignals } from './context-eval.js';
import { buildBriefingMessage } from './format-briefing.js';
import { extractRichFromText, isValidRichBlock } from './rich-block-extract.js';
import type { RouteOptions, RouteStrategyDeps } from './route-helpers.js';
import {
  assembleIncrementalContext,
  createLeakedToolCallStreamStripper,
  detectContextDegradation,
  getService,
  getThreadBootcampMemberCount,
  isUserFacingSystemInfoContent,
  routeContentBlocksForAgent,
  sanitizeInjectedContent,
  shouldAppendExplicitCurrentMessage,
  toStoredToolEvent,
  upsertMaxBoundary,
} from './route-helpers.js';
import { appendThinkingChunk, renderThinkingChunks } from './thinking-chunks.js';
import { buildVoteTally, checkVoteCompletion, extractVoteFromText, VOTE_RESULT_SOURCE } from './vote-intercept.js';

const log = createModuleLogger('route-parallel');

export async function* routeParallel(
  deps: RouteStrategyDeps,
  targetAgents: AgentId[],
  message: string,
  userId: string,
  threadId: string,
  options: RouteOptions = {},
): AsyncIterable<AgentMessage> {
  const {
    contentBlocks,
    uploadDir,
    signal,
    signalForAgent,
    promptTags,
    contextHistory,
    history,
    currentUserMessageId,
    modeSystemPrompt,
    modeSystemPromptByAgent,
  } = options;
  const thinkingMode = options.thinkingMode ?? 'play';
  // P2-3 fix: also consider default MCP server path (ClaudeAgentService has fallback resolution)
  const mcpServerPath = process.env.AGENT_STUDIO_MCP_SERVER_PATH || resolveDefaultClaudeMcpServerPath();
  const incrementalMode = Boolean(currentUserMessageId && deps.deliveryCursorStore);

  const degradationMsgs: AgentMessage[] = [];
  const boundaryByAgent = new Map<AgentId, string | undefined>();

  // F042 Wave 3: Fetch thread participant activity once (shared across all agents).
  let activeParticipants: { agentId: AgentId; lastMessageAt: number; messageCount: number }[] = [];
  if (deps.invocationDeps.threadStore) {
    try {
      activeParticipants = await deps.invocationDeps.threadStore.getParticipantsWithActivity(threadId);
    } catch {
      /* best-effort */
    }
  }
  // F042: Fetch thread routingPolicy once (shared across all agents).
  let routingPolicy: ThreadRoutingPolicyV1 | undefined;
  // F073 P4: SOP stage hint from workflow-sop (告示牌 — info only, agents decide actions)
  let sopStageHint:
    | { stage: string; suggestedSkill: string; suggestedSkillSource: string; featureId: string }
    | undefined;
  // F092: Voice companion mode
  let voiceMode: boolean | undefined;
  // F087: Bootcamp state for operator onboarding
  let bootcampState: InvocationContext['bootcampState'];
  const targetAgentIds = new Set<string>(targetAgents);
  // Thread read: shared across routingPolicy, voiceMode, bootcamp, SOP, and guide interceptor
  let routeThread: Thread | null = null;
  if (deps.invocationDeps.threadStore) {
    try {
      routeThread = (await deps.invocationDeps.threadStore.get(threadId)) ?? null;
      routingPolicy = routeThread?.routingPolicy;
      voiceMode = routeThread?.voiceMode;
      bootcampState = routeThread?.bootcampState;
      // F073 P4: Read workflow-sop if thread is linked to a backlog item
      if (routeThread?.backlogItemId && deps.invocationDeps.workflowSopStore) {
        try {
          const sop = await deps.invocationDeps.workflowSopStore.get(routeThread.backlogItemId);
          if (sop) {
            const skill = resolveWorkflowSopSkill(sop);
            sopStageHint = {
              stage: sop.stage,
              suggestedSkill: skill.skill,
              suggestedSkillSource: skill.source,
              featureId: sop.featureId,
            };
          }
        } catch {
          /* best-effort: SOP hint failure does not block invocation */
        }
      }
    } catch {
      /* best-effort */
    }
  }
  const bootcampMemberCount = getThreadBootcampMemberCount(routeThread);

  // F155: Guide interceptor — resume existing guide state only
  const guideCtx = await prepareGuideContext({
    thread: routeThread,
    guideSessionStore: deps.invocationDeps.guideSessionStore,
    targetAgents,
    message,
    userId,
    threadId,
    log,
    dismissTracker: deps.invocationDeps.dismissTracker,
  });

  // F229: Concierge interceptor — load duty-agent 岗位 context for concierge threads
  const conciergeCtx = await prepareConciergeContext(routeThread, userId, deps.invocationDeps.conciergeConfigStore);

  // F229 KD-17: Pre-fetch search context for concierge threads
  let conciergeSearchContextString = '';
  if ('conciergeConfig' in conciergeCtx && deps.invocationDeps.conciergeHandleMapStore) {
    try {
      const searchResult = await buildConciergeSearchContext({
        userMessage: message,
        threadId,
        handleMapStore: deps.invocationDeps.conciergeHandleMapStore,
        evidenceStore: deps.evidenceStore,
      });
      conciergeSearchContextString = searchResult.contextString;
    } catch {
      // Fail-open
    }
  }

  // F148 OQ-2: briefing→invocation link per agent (must be before Promise.all — TDZ fix)
  const agentBriefingMessageId = new Map<string, string>();
  // F148 OQ-2: Collect tool names and coverage maps per agent for context eval
  const agentToolNames = new Map<string, string[]>();
  const agentCoverageMap = new Map<string, ContextEvalInput['coverageMap']>();

  const streams = await Promise.all(
    targetAgents.map(async (agentId) => {
      const agentConfig: AgentConfig | undefined = agentRegistry.tryGet(agentId as string)?.config;
      const teammates = targetAgents.filter((id) => id !== agentId);
      // F203 Phase C: non-pack identity/家规/MCP docs travel via the
      // compression-immune native system role (--system-prompt-file / -c)
      // ONLY for providers with native L0 injection (ClaudeAgentService -p,
      // ClaudeBgCarrierService, CodexAgent). Non-native providers (Gemini,
      // Antigravity, AgentRunner, A2A, OpenCode, Dare, Kimi…) still need full
      // identity via user-message systemPrompt prepend, else they
      // lose identity/家规 entirely (云端 Codex P1-cloud-1, 2026-05-16).
      // mcpAvailable still gates the per-message HTTP callback fallback.
      const mcpConfigured = (agentConfig?.mcpSupport ?? false) && !!mcpServerPath;
      const mcpAvailable = isNativeMcpAvailable(mcpConfigured, agentConfig?.clientId);
      // F129: Load active pack blocks (best-effort)
      let packBlocks: import('@agent-studio/shared').CompiledPackBlocks | null = null;
      if (deps.packStore) {
        const { getActivePackBlocks } = await import('../../../../packs/getActivePackBlocks.js');
        packBlocks = await getActivePackBlocks(deps.packStore);
      }
      const service = getService(deps.services, agentId);
      const hasNativeL0 = service.injectsL0Natively?.() ?? false;
      // Staging is injected in invoke-single-agent independently of staticIdentity
      // (Cloud R2 P1 #2237 L1099). See route-serial.ts for the architecture rationale.
      const staticIdentity = hasNativeL0
        ? buildStaticIdentityPackOnly(agentId, { packBlocks })
        : buildStaticIdentity(agentId, { mcpAvailable, packBlocks });
      // F041: inject HTTP callback only when MCP is NOT actually available (fallback)
      const mcpInstructions = needsMcpInjection(mcpAvailable, agentConfig?.clientId)
        ? buildMcpCallbackInstructions({
            currentAgentId: agentId as string,
            teammates: teammates.map((id) => id as string),
          })
        : '';
      // F091: Inject linked signal articles into context
      let activeSignals:
        | readonly {
            id: string;
            title: string;
            source: string;
            tier: number;
            contentSnippet: string;
            note?: string | undefined;
            relatedDiscussions?: readonly { sessionId: string; snippet: string; score: number }[] | undefined;
          }[]
        | undefined;
      if (deps.invocationDeps.signalArticleLookup) {
        try {
          const signals = await deps.invocationDeps.signalArticleLookup(threadId);
          if (signals.length > 0) activeSignals = signals;
        } catch {
          /* best-effort: signal lookup failure does not block invocation */
        }
      }

      // F163 AC-A3: always_on constitutional docs injection (fail-open, flag-gated)
      // shadow: query but do NOT inject into prompt (record-only for experiment diff)
      // on: query AND inject into prompt
      // off: skip entirely
      let alwaysOnDocs: readonly { anchor: string; title: string; summary: string }[] | undefined;
      let alwaysOnInjectionMode: 'off' | 'shadow' | 'on' = 'off';
      if (deps.evidenceStore) {
        try {
          const { freezeFlags } = await import('../../../../../domains/memory/f163-types.js');
          const f163Flags = freezeFlags();
          alwaysOnInjectionMode = f163Flags.alwaysOnInjection;
          if (alwaysOnInjectionMode !== 'off') {
            const evStore = deps.evidenceStore as {
              queryAlwaysOn?: () => Array<{ anchor: string; title: string; summary: string }>;
            };
            if (typeof evStore.queryAlwaysOn === 'function') {
              const docs = evStore.queryAlwaysOn();
              if (docs.length > 0) alwaysOnDocs = docs;
            }
          }
        } catch {
          /* fail-open: always_on lookup failure does not block invocation */
        }
      }

      const invocationContext = buildInvocationContext({
        agentId,
        mode: 'parallel',
        teammates,
        mcpAvailable,
        ...(promptTags && promptTags.length > 0 ? { promptTags } : {}),
        ...(activeParticipants.length > 0 ? { activeParticipants } : {}),
        ...(routingPolicy ? { routingPolicy } : {}),
        ...(sopStageHint ? { sopStageHint } : {}),
        ...(activeSignals ? { activeSignals } : {}),
        ...(voiceMode ? { voiceMode } : {}),
        ...(bootcampState ? { bootcampState, threadId, bootcampMemberCount } : {}),
        ...(alwaysOnDocs && alwaysOnInjectionMode === 'on' ? { alwaysOnDocs } : {}),
        ...guideContextForAgent(guideCtx, agentId, targetAgentIds, threadId),
        ...conciergeContextForAgent(conciergeCtx, agentId as string),
      });
      const continuityCapsule = buildCapsuleFromRouteState({
        threadId,
        agentId: agentId as string,
        ...(options.parentInvocationId ? { parentInvocationId: options.parentInvocationId } : {}),
        mode: 'parallel',
        a2aEnabled: false,
      });

      const targetContentBlocks = routeContentBlocksForAgent(agentId, contentBlocks);
      const targetUploadDir = targetContentBlocks ? uploadDir : undefined;

      // F24 Phase E: Bootstrap context for Session #2+
      // #836: Reborn agents skip bootstrap — every invocation starts with zero prior context.
      // Uses store lookup (not thread field) — Redis memberSS:* fields aren't hydrated by get().
      let bootstrapCtx = '';
      // #836: Reborn check is best-effort — transient Redis failure must not
      // abort the invocation before bootstrap/routing. Default to non-reborn.
      let isParReborn = false;
      try {
        isParReborn = deps.invocationDeps.threadStore?.isRebornSession
          ? await Promise.resolve(deps.invocationDeps.threadStore.isRebornSession(threadId, agentId as string))
          : false;
      } catch (rebornErr) {
        log.warn(
          { threadId, agentId },
          '[routeParallel] #836: isRebornSession lookup failed pre-bootstrap, defaulting to non-reborn',
        );
      }
      if (
        !isParReborn &&
        isSessionChainEnabled(agentId) &&
        deps.invocationDeps.sessionChainStore &&
        deps.invocationDeps.transcriptReader
      ) {
        try {
          const bootstrapDepth = getConfigSessionStrategy(agentId)?.handoff?.bootstrapDepth;
          const bootstrap = await buildSessionBootstrap(
            {
              sessionChainStore: deps.invocationDeps.sessionChainStore,
              transcriptReader: deps.invocationDeps.transcriptReader,
              ...(deps.invocationDeps.taskStore ? { taskStore: deps.invocationDeps.taskStore } : {}),
              ...(deps.invocationDeps.threadStore ? { threadStore: deps.invocationDeps.threadStore } : {}),
              ...(bootstrapDepth ? { bootstrapDepth } : {}),
            },
            agentId,
            threadId,
          );
          if (bootstrap) {
            bootstrapCtx = bootstrap.text;
          }
        } catch {
          // Best-effort: bootstrap failure doesn't block invocation
        }
      }

      let prompt: string;
      if (incrementalMode) {
        // A+ fix: calculate effective context budget by deducting ALL system parts from maxPromptTokens.
        const parAgentModePromptForBudget = modeSystemPromptByAgent?.[agentId as string] ?? modeSystemPrompt;
        const parIncBudget = getAgentContextBudget(agentId as string);
        const parIncSystemTokens = estimateTokens(
          [staticIdentity, invocationContext, parAgentModePromptForBudget, bootstrapCtx, mcpInstructions]
            .filter(Boolean)
            .join('\n'),
        );
        const parIncMessageTokens = estimateTokens(message);
        const parEffectiveContextBudget = Math.min(
          Math.max(0, parIncBudget.maxPromptTokens - parIncSystemTokens - parIncMessageTokens - 200),
          parIncBudget.maxContextTokens,
        );

        const inc = await assembleIncrementalContext(
          deps,
          userId,
          threadId,
          agentId,
          currentUserMessageId,
          thinkingMode,
          {
            effectiveMaxContextTokens: parEffectiveContextBudget,
            canonicalFeatureId: sopStageHint?.featureId,
            threadTitle: routeThread?.title ?? undefined,
          },
        );
        boundaryByAgent.set(agentId, inc.boundaryId);
        if (inc.degradation) {
          degradationMsgs.push({
            type: 'system_info' as AgentMessageType,
            agentId,
            content: inc.degradation,
            timestamp: Date.now(),
          } as AgentMessage);
        }

        // F148 Phase E: Auto-insert context briefing when smart window triggered (AC-E1)
        if (inc.coverageMap) {
          const briefingInput = buildBriefingMessage(inc.coverageMap, threadId, inc.briefingContext);
          try {
            const stored = await deps.messageStore.append(briefingInput);
            agentBriefingMessageId.set(agentId, stored.id);
            agentCoverageMap.set(agentId, inc.coverageMap);
            // P1-3: Include full stored message in payload so frontend can addMessage directly
            degradationMsgs.push({
              type: 'system_info' as AgentMessageType,
              agentId,
              content: JSON.stringify({
                type: 'context_briefing',
                messageId: stored.id,
                storedMessage: {
                  id: stored.id,
                  content: stored.content,
                  origin: stored.origin,
                  timestamp: stored.timestamp,
                  extra: stored.extra,
                },
              }),
              timestamp: stored.timestamp,
            } as AgentMessage);
          } catch {
            // fail-open: briefing is non-critical UI enhancement
          }
        }

        const parAgentModePrompt = modeSystemPromptByAgent?.[agentId as string] ?? modeSystemPrompt;
        const parts = [invocationContext, parAgentModePrompt, bootstrapCtx, mcpInstructions].filter(Boolean);
        if (inc.contextText) parts.push(inc.contextText);
        // F35 fix: only inject raw message when it was genuinely absent from unseen rows.
        // Defensive guard: if the current message ID is already present anywhere in
        // the assembled context text, do not append the raw message again.
        if (shouldAppendExplicitCurrentMessage(inc, currentUserMessageId)) parts.push(message);
        prompt = parts.join('\n\n---\n\n');
      } else {
        // Per-agent context budget (Phase 4.0)
        let agentContextHistory = contextHistory;
        if (history && history.length > 0 && !contextHistory) {
          const budget = getAgentContextBudget(agentId as string);
          // F8: token-based budget — estimate non-context tokens, remainder goes to context
          // A+ fix: include agentModePrompt + bootstrapCtx in system parts estimate (P2-1)
          const parAgentModePromptLegacyForBudget = modeSystemPromptByAgent?.[agentId as string] ?? modeSystemPrompt;
          const parSystemTokens = estimateTokens(
            [staticIdentity, invocationContext, parAgentModePromptLegacyForBudget, bootstrapCtx, mcpInstructions]
              .filter(Boolean)
              .join('\n'),
          );
          const parPromptTokens = estimateTokens(message);
          const budgetForContext = Math.max(0, budget.maxPromptTokens - parSystemTokens - parPromptTokens - 200);
          const { contextText, messageCount } = assembleContext(history, {
            maxMessages: budget.maxMessages,
            maxContentLength: budget.maxContentLengthPerMsg,
            maxTotalTokens: Math.min(budgetForContext, budget.maxContextTokens),
          });
          agentContextHistory = contextText || undefined;

          // Degradation check: notify user if context was truncated (count budget or char budget)
          const degradation = detectContextDegradation(history.length, messageCount, budget);
          if (degradation?.degraded) {
            degradationMsgs.push({
              type: 'system_info' as AgentMessageType,
              agentId,
              content: formatDegradationMessage(degradation),
              timestamp: Date.now(),
            } as AgentMessage);
          }
        }

        const parAgentModePromptLegacy = modeSystemPromptByAgent?.[agentId as string] ?? modeSystemPrompt;
        if (invocationContext || parAgentModePromptLegacy || mcpInstructions || bootstrapCtx) {
          const parts = [invocationContext, parAgentModePromptLegacy, bootstrapCtx, mcpInstructions].filter(Boolean);
          if (agentContextHistory) parts.push(agentContextHistory);
          prompt = `${parts.join('\n\n---\n\n')}\n\n---\n\n${message}`;
        } else if (agentContextHistory) {
          prompt = `${agentContextHistory}\n\n---\n\n${message}`;
        } else {
          prompt = message;
        }
      }

      // F229 KD-17: Inject search context into duty agent prompt
      if (conciergeSearchContextString && conciergeContextForAgent(conciergeCtx, agentId as string)?.conciergeConfig) {
        prompt = `${prompt}\n${conciergeSearchContextString}`;
      }

      // F-parallel-cancel: each concurrent agent listens to ITS OWN slot signal, not the
      // shared primaryController.signal — canceling one agent must not abort its siblings.
      const agentSignal = signalForAgent?.(agentId) ?? signal;
      // F-parallel-cancel (cloud P2): skip invoke for a agent already cancelled BEFORE this route
      // started it (tombstone aborted signal — e.g. user clicked Stop on this agent pre-invoke).
      // Otherwise invokeSingleAgent turns the aborted iterator into error+done, broadcasting /
      // persisting a user_cancel as an error instead of silently skipping. route-serial does the
      // equivalent via its loop-top `if (agentSignal?.aborted)` check.
      if (agentSignal?.aborted) {
        return (async function* skipCancelledAgent(): AsyncGenerator<AgentMessage> {})();
      }
      return invokeSingleAgent(deps.invocationDeps, {
        agentId,
        service,
        prompt,
        userId,
        threadId,
        ...(targetContentBlocks ? { contentBlocks: targetContentBlocks } : {}),
        ...(targetUploadDir ? { uploadDir: targetUploadDir } : {}),
        ...(agentSignal ? { signal: agentSignal } : {}),
        ...(staticIdentity ? { systemPrompt: staticIdentity } : {}),
        // F194 Phase Z2 (砚砚 catch 2026-05-09)：parallel route 必须传 parentInvocationId，
        // 与 route-serial.ts:725 对齐。否则 child registry record 缺 parentInvocationId →
        // helper namespace bridge 失效 → ideate/parallel 场景气泡又裂。
        ...(options.parentInvocationId ? { parentInvocationId: options.parentInvocationId } : {}),
        ...(options.routeSpan ? { routeSpan: options.routeSpan } : {}),
        continuityCapsule,
        isLastAgent: false,
      });
    }),
  );

  // Yield degradation notifications before streaming starts (BACKLOG #32)
  for (const dm of degradationMsgs) {
    yield dm;
  }

  const agentText = new Map<string, string>();
  const agentThinking = new Map<string, string[]>();
  const agentMeta = new Map<string, MessageMetadata>();
  const agentSawUserFacingSystemInfo = new Map<string, boolean>();
  const agentToolEvents = new Map<string, StoredToolEvent[]>();
  // F060: Collect inline rich blocks per agent from system_info stream
  const agentStreamRichBlocks = new Map<string, import('@agent-studio/shared').RichBlock[]>();
  const agentErrorText = new Map<string, string>();
  // F212 Phase B (云端 codex P2-8 2026-05-27): per-agent capture of Phase A's structured
  // cliDiagnostics so persistence carries it through to F5 hydration (symmetric with route-serial).
  const agentCliDiagnostics = new Map<string, import('@agent-studio/shared').CliDiagnostics>();
  const agentHadError = new Set<string>();
  // #267: track errors that happened BEFORE abort — only these are real provider failures
  const agentHadProviderError = new Set<string>();
  // F22 R2 P1-1: Capture own invocationId per agent from stream
  const agentInvocationId = new Map<string, string>();
  const completedAgentInvocationIds: Array<[string, string]> = [];
  const agentPayloadStrippers = new Map<string, ReturnType<typeof createLeakedToolCallStreamStripper>>();
  let completedCount = 0;
  let yieldedFinalDone = false;
  // F153: Accumulate total tokens across all parallel streams for route aggregate
  let routeTotalTokens = 0;

  // #80: Per-agent draft flush state
  const agentFlushTime = new Map<string, number>();
  const agentFlushLen = new Map<string, number>();
  const agentFlushToolLen = new Map<string, number>();
  const FLUSH_INTERVAL_MS = 2000;
  const FLUSH_CHAR_DELTA = 2000;
  const noop = () => {};

  // Issue #83: Independent keepalive timer — touch draft every 60s during long tool calls.
  const KEEPALIVE_INTERVAL_MS = 60_000;
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  // Track which agents have had their keepalive started
  let keepaliveStarted = false;

  function getPayloadStripper(agentId: string) {
    let stripper = agentPayloadStrippers.get(agentId);
    if (!stripper) {
      stripper = createLeakedToolCallStreamStripper();
      agentPayloadStrippers.set(agentId, stripper);
    }
    return stripper;
  }

  // F200 HW-4 根因①: per-agent pending tool FIFO. Claude/Opus parallel
  // tool_result often carries no result-side toolName/toolUseId/mcp label;
  // without a fallback the result-side summary (incl. _f200Candidates) is
  // never merged (audit Round 1: 59.2% candidates_json=[]). route-serial.ts
  // has consumePendingToolResult; parallel had none. Keyed by agentId because
  // parallel runs multiple agents concurrently.
  // 砚砚 HW-4 R1-2 review: entries carry toolUseId so an exact result can
  // splice its own entry by id (not the first same-name), preventing
  // same-name queue drift (search→graph→search).
  const pendingToolResultsByAgent = new Map<string, Array<{ toolName: string; toolUseId?: string }>>();
  const invocationStartedAt = Date.now();
  for await (const msg of mergeStreams(streams, (idx, err) => {
    log.error({ streamIndex: idx, err }, 'Parallel stream error');
  })) {
    const effectiveMsgs: AgentMessage[] = [];
    if (msg.type === 'text' && msg.content && msg.agentId) {
      effectiveMsgs.push({ ...msg, content: getPayloadStripper(msg.agentId).push(msg.content) });
    } else if (msg.type === 'done' && msg.agentId) {
      if (msg.metadata && !agentMeta.has(msg.agentId)) {
        agentMeta.set(msg.agentId, msg.metadata);
      }
      const flushedText = getPayloadStripper(msg.agentId).flush();
      if (flushedText) {
        effectiveMsgs.push({
          type: 'text',
          agentId: msg.agentId,
          content: flushedText,
          timestamp: msg.timestamp,
        });
      }
    } else {
      effectiveMsgs.push(msg);
    }

    for (const effectiveMsg of effectiveMsgs) {
      // F22 R2 P1-1: Capture invocationId from the initial system_info per agent.
      // Keep forwarding this boundary event so frontend can reset stale task progress.
      if (
        effectiveMsg.type === 'system_info' &&
        effectiveMsg.content &&
        effectiveMsg.agentId &&
        !agentInvocationId.has(effectiveMsg.agentId)
      ) {
        try {
          const parsed = JSON.parse(effectiveMsg.content);
          if (parsed.type === 'invocation_created') {
            agentInvocationId.set(effectiveMsg.agentId, parsed.invocationId);
            // #80 fix: seed flush baseline so interval triggers after FLUSH_INTERVAL_MS
            agentFlushTime.set(effectiveMsg.agentId, Date.now());
            // Issue #83: Start a single keepalive timer that touches all active drafts.
            if (deps.draftStore && !keepaliveStarted) {
              keepaliveStarted = true;
              keepaliveTimer = setInterval(() => {
                for (const [, invId] of agentInvocationId) {
                  deps.draftStore!.touch(userId, threadId, invId)?.catch?.(noop);
                }
              }, KEEPALIVE_INTERVAL_MS);
            }
          }
        } catch {
          /* ignore parse errors */
        }
      }
      if (effectiveMsg.type === 'text' && effectiveMsg.content && effectiveMsg.agentId) {
        agentText.set(
          effectiveMsg.agentId,
          accumulateTextAggregate(
            agentText.get(effectiveMsg.agentId) ?? '',
            effectiveMsg.content,
            (effectiveMsg as { textMode?: 'append' | 'replace' }).textMode,
          ),
        );
      }
      // F045: Accumulate thinking blocks per agent for persistence (F5 recovery)
      if (effectiveMsg.type === 'system_info' && effectiveMsg.content && effectiveMsg.agentId) {
        if (isUserFacingSystemInfoContent(effectiveMsg.content)) {
          agentSawUserFacingSystemInfo.set(effectiveMsg.agentId, true);
        }
        try {
          const parsed = JSON.parse(effectiveMsg.content);
          if (parsed.type === 'thinking' && typeof parsed.text === 'string') {
            const prev = agentThinking.get(effectiveMsg.agentId) ?? [];
            agentThinking.set(effectiveMsg.agentId, appendThinkingChunk(prev, parsed.text));
          }
          // F060: Collect inline rich_block for persistence (P1 fix)
          if (parsed.type === 'rich_block' && parsed.block && isValidRichBlock(parsed.block)) {
            const arr = agentStreamRichBlocks.get(effectiveMsg.agentId) ?? [];
            arr.push(parsed.block);
            agentStreamRichBlocks.set(effectiveMsg.agentId, arr);
          }
          // F153: Accumulate invocation tokens for route aggregate
          if (parsed.type === 'invocation_usage' && parsed.usage) {
            routeTotalTokens += (parsed.usage.inputTokens ?? 0) + (parsed.usage.outputTokens ?? 0);
          }
        } catch {
          /* ignore parse errors */
        }
      }
      // F-parallel-cancel (cloud #4 2026-05-30): a agent cancelled AFTER its stream started has its
      // abort converted by invokeSingleAgent (abortableNext reject) into an error+done. Drop the
      // abort-induced error entirely: don't record it (else the done block persists a user_cancel as
      // an error message ~1262) and don't yield it (else messages.ts/QueueProcessor broadcast it as a
      // provider failure). The batch gate is intentionally NOT aborted on single-agent cancel, so the
      // consume-loop's `controller.signal.aborted` guard never catches this — mirrors serial route's
      // `if (agentSignal?.aborted) break`. Partial pre-abort text still persists via the done block
      // (hadError=false; #267 keeps aborted agents out of agentHadProviderError).
      if (
        effectiveMsg.type === 'error' &&
        effectiveMsg.agentId &&
        (signalForAgent?.(effectiveMsg.agentId) ?? signal)?.aborted
      ) {
        continue;
      }
      if (effectiveMsg.type === 'error' && effectiveMsg.agentId) {
        agentHadError.add(effectiveMsg.agentId);
        // #267: errors before abort are real provider failures; errors after abort are cleanup
        // F-parallel-cancel: judge abort with THIS agent's own signal, not the shared one —
        // else canceling one concurrent agent mislabels a sibling's real error as cleanup.
        if (!(signalForAgent?.(effectiveMsg.agentId) ?? signal)?.aborted)
          agentHadProviderError.add(effectiveMsg.agentId);
        if (effectiveMsg.error) {
          const prev = agentErrorText.get(effectiveMsg.agentId) ?? '';
          agentErrorText.set(effectiveMsg.agentId, `${prev}${prev ? '\n' : ''}${effectiveMsg.error}`);
        }
        // F212 Phase B (云端 codex P2-8): capture first cliDiagnostics seen per agent.
        const meta = effectiveMsg.metadata as
          | { cliDiagnostics?: import('@agent-studio/shared').CliDiagnostics }
          | undefined;
        if (meta?.cliDiagnostics && !agentCliDiagnostics.has(effectiveMsg.agentId)) {
          agentCliDiagnostics.set(effectiveMsg.agentId, meta.cliDiagnostics);
        }
      }
      // Accumulate tool events per agent
      const toolEvt = toStoredToolEvent(effectiveMsg);
      if (toolEvt && effectiveMsg.agentId) {
        const arr = agentToolEvents.get(effectiveMsg.agentId) ?? [];
        arr.push(toolEvt);
        agentToolEvents.set(effectiveMsg.agentId, arr);
      }

      // F148 OQ-2: Collect tool names for context eval
      if (effectiveMsg.type === 'tool_use' && effectiveMsg.toolName && effectiveMsg.agentId) {
        const names = agentToolNames.get(effectiveMsg.agentId) ?? [];
        names.push(effectiveMsg.toolName);
        agentToolNames.set(effectiveMsg.agentId, names);
      }

      // F150: Fire-and-forget tool usage counter
      if (effectiveMsg.type === 'tool_use' && deps.toolUsageCounter && effectiveMsg.agentId) {
        deps.toolUsageCounter.recordToolUse(
          effectiveMsg.agentId as string,
          effectiveMsg.toolName ?? 'unknown',
          effectiveMsg.toolInput as Record<string, unknown> | undefined,
        );
      }
      // F188 Phase F AC-F10: append-only tool event log (砚砚 三审 P1 wiring)
      if (effectiveMsg.type === 'tool_use' && deps.toolEventLog && effectiveMsg.agentId) {
        const msg = effectiveMsg as {
          agentId?: string;
          toolName?: string;
          toolInput?: Record<string, unknown>;
          toolUseId?: string;
          invocationId?: string;
          sessionId?: string;
          threadId?: string;
          turnIndex?: number;
        };
        // 砚砚 四审 P1-1: normalizeMcpToolName handles mcp__/mcp:/agent_studio_ child extraction
        const rawToolName = msg.toolName ?? 'unknown';
        const classification = classifyTool(rawToolName, msg.toolInput);
        const normalizedToolName =
          classification.category === 'skill' ? classification.toolName : normalizeMcpToolName(rawToolName);
        // 砚砚 cloud P2: prefer per-agent invocation captured from system_info over literal 'unknown'.
        // Mirrors serial route's `ownInvocationId` fallback chain (route-serial.ts:912).
        // sessionId likewise falls back to per-agent invocation so parallel-agent skill-load
        // counts don't collapse onto sessionId='unknown' across unrelated invocations.
        const ownInv = msg.agentId ? agentInvocationId.get(msg.agentId) : undefined;
        // 砚砚 cloud-3 P1: propagate toolUseId into summary (as _toolUseId) so
        // updateSummary can do exact match when provider emits it on tool_result.
        // Falls back to FIFO toolName+agentId match when toolUseId absent.
        const baseSummary = (msg.toolInput ?? {}) as Record<string, unknown>;
        const summary: Record<string, unknown> = msg.toolUseId
          ? { ...baseSummary, _toolUseId: msg.toolUseId }
          : baseSummary;
        deps.toolEventLog
          .append({
            invocationId: msg.invocationId ?? ownInv ?? 'unknown',
            sessionId: msg.sessionId ?? ownInv ?? 'unknown',
            threadId: msg.threadId ?? threadId ?? 'unknown',
            agentId: msg.agentId ?? 'unknown',
            toolName: normalizedToolName,
            timestamp: Date.now(),
            turnIndex: msg.turnIndex ?? 0,
            status: 'success',
            summary,
          })
          .catch(() => {});
        // F200 HW-4 根因①: enqueue into per-agent FIFO so a later nameless
        // result-side tool_result can still be paired back to this tool.
        {
          const pk = msg.agentId ?? 'unknown';
          const pq = pendingToolResultsByAgent.get(pk) ?? [];
          pq.push({ toolName: normalizedToolName, toolUseId: msg.toolUseId });
          pendingToolResultsByAgent.set(pk, pq);
        }
        // 砚砚 二审 P1-4: Skill tool_use → SkillLoadEventLog (AS-4)
        if (rawToolName === 'Skill' && deps.skillLoadEventLog) {
          const skillName =
            msg.toolInput && typeof msg.toolInput['skill'] === 'string'
              ? (msg.toolInput['skill'] as string)
              : 'unknown';
          deps.skillLoadEventLog
            .append({
              invocationId: msg.invocationId ?? ownInv ?? 'unknown',
              sessionId: msg.sessionId ?? ownInv ?? 'unknown',
              skillId: skillName,
              loadTrigger: 'explicit_call',
              timestamp: Date.now(),
            })
            .catch(() => {});
        }
      }
      if (effectiveMsg.metadata && effectiveMsg.agentId && !agentMeta.has(effectiveMsg.agentId)) {
        agentMeta.set(effectiveMsg.agentId, effectiveMsg.metadata);
      }

      // F188 Phase F AC-F10 (砚砚 七审 P1): merge result-side summary; parses real Codex
      // tool_result format "mcp:server/tool (completed)" — mirrors serial route's
      // inferToolResultName logic (route-serial.ts:177).
      if (effectiveMsg.type === 'tool_result' && deps.toolEventLog) {
        const msg = effectiveMsg as { toolName?: string; content?: unknown };
        let toolNameCandidate = msg.toolName;
        if (!toolNameCandidate) {
          const text =
            typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? (msg.content as Array<{ text?: unknown }>)
                    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
                    .join('\n')
                : '';
          const firstLine = text.trimStart().split('\n', 1)[0]?.trim();
          if (firstLine) {
            // Codex mcp_tool_call result: "mcp:server/tool (completed)" / "(failed)"
            const mcpMatch = firstLine.match(/^(mcp:[^\s]+)\s+\(/);
            if (mcpMatch?.[1]) toolNameCandidate = mcpMatch[1];
            else if (firstLine.startsWith('command: ')) toolNameCandidate = 'command_execution';
            else {
              const labelMatch = /\[tool:([\w\-:/_.]+)\]/.exec(firstLine);
              if (labelMatch?.[1]) toolNameCandidate = labelMatch[1];
            }
          }
        }
        // F200 HW-4 根因①: per-agent pending FIFO. Nameless result-side
        // (Claude/Opus parallel) → FIFO fallback (mirrors route-serial.ts:197-227
        // pure-FIFO branch). Resolved name → splice its FIFO entry so a later
        // nameless result can't mis-pair (砚砚 R1 review: queue-drift guard).
        {
          const resultMsg2 = effectiveMsg as { agentId?: string; toolUseId?: string };
          const cq = resultMsg2.agentId ? pendingToolResultsByAgent.get(resultMsg2.agentId) : undefined;
          if (toolNameCandidate) {
            if (cq) {
              // 砚砚 HW-4 R1-2: exact result → splice its OWN entry by
              // toolUseId when present (precise); else first same-name.
              // Prevents same-name drift (search→graph→search).
              let si = -1;
              if (resultMsg2.toolUseId) {
                si = cq.findIndex((e) => e.toolUseId === resultMsg2.toolUseId);
              }
              if (si < 0) {
                const nn = normalizeMcpToolName(toolNameCandidate);
                si = cq.findIndex((e) => e.toolName === nn);
              }
              if (si >= 0) cq.splice(si, 1);
            }
          } else if (cq && cq.length > 0) {
            toolNameCandidate = cq.shift()!.toolName;
          }
        }
        if (toolNameCandidate) {
          const normalizedName = normalizeMcpToolName(toolNameCandidate);
          const resultSummary = deriveResultSummary(normalizedName, msg.content);
          if (Object.keys(resultSummary).length > 0) {
            // 砚砚 六审 P1-B: scope updateSummary match to specific agent (parallel
            // route runs multiple agents concurrently; same tool name can collide).
            // 砚砚 cloud-3 P1: also pass toolUseId for exact match when available;
            // otherwise FIFO toolName+agentId match handles same-name parallel calls.
            const resultMsg = effectiveMsg as { agentId?: string; toolUseId?: string };
            const matcher: { toolUseId?: string; toolName?: string; agentId?: string } = resultMsg.toolUseId
              ? { toolUseId: resultMsg.toolUseId }
              : resultMsg.agentId
                ? { toolName: normalizedName, agentId: resultMsg.agentId }
                : { toolName: normalizedName };
            deps.toolEventLog.updateSummary(threadId, matcher, resultSummary).catch(() => {});
          }
        }
      }

      // #80: Draft flush — fire-and-forget periodic persistence per agent
      if (deps.draftStore && effectiveMsg.agentId && agentInvocationId.has(effectiveMsg.agentId)) {
        const invId = agentInvocationId.get(effectiveMsg.agentId)!;
        const now = Date.now();
        const lastFlush = agentFlushTime.get(effectiveMsg.agentId) ?? now;
        const lastLen = agentFlushLen.get(effectiveMsg.agentId) ?? 0;
        const curText = agentText.get(effectiveMsg.agentId) ?? '';
        const charDelta = curText.length - lastLen;
        const isReplaceText = (effectiveMsg as { textMode?: 'append' | 'replace' }).textMode === 'replace';

        const lastToolLen = agentFlushToolLen.get(effectiveMsg.agentId) ?? 0;
        const curTools = agentToolEvents.get(effectiveMsg.agentId);
        const curToolLen = curTools?.length ?? 0;

        const neverFlushedAgent = lastLen === 0 && lastToolLen === 0;
        if (
          effectiveMsg.type === 'text' &&
          charDelta !== 0 &&
          (neverFlushedAgent || isReplaceText || now - lastFlush >= FLUSH_INTERVAL_MS || charDelta >= FLUSH_CHAR_DELTA)
        ) {
          const curThinking = agentThinking.get(effectiveMsg.agentId);
          deps.draftStore
            .upsert({
              userId,
              threadId,
              invocationId: invId,
              agentId: effectiveMsg.agentId as AgentId,
              content: curText,
              ...(curTools && curToolLen > 0 ? { toolEvents: curTools } : {}),
              ...(curThinking && curThinking.length > 0 ? { thinking: renderThinkingChunks(curThinking) } : {}),
              updatedAt: now,
            })
            ?.catch?.(noop);
          agentFlushTime.set(effectiveMsg.agentId, now);
          agentFlushLen.set(effectiveMsg.agentId, curText.length);
          agentFlushToolLen.set(effectiveMsg.agentId, curToolLen);
        } else if (
          (effectiveMsg.type === 'tool_use' || effectiveMsg.type === 'tool_result') &&
          // Cloud R7 P1: bypass interval for the very first flush — tool-first invocations
          // must create a draft immediately, not wait 2s for the interval gate.
          (neverFlushedAgent || now - lastFlush >= FLUSH_INTERVAL_MS)
        ) {
          // Cloud R6 P1: upsert when there's unsaved text OR new tool events —
          // tool-first invocations (no text yet) must still create a draft record.
          if (curText.length > lastLen || curToolLen > lastToolLen) {
            const curThinkingTool = agentThinking.get(effectiveMsg.agentId);
            deps.draftStore
              .upsert({
                userId,
                threadId,
                invocationId: invId,
                agentId: effectiveMsg.agentId as AgentId,
                content: curText,
                ...(curTools && curToolLen > 0 ? { toolEvents: curTools } : {}),
                ...(curThinkingTool && curThinkingTool.length > 0
                  ? { thinking: renderThinkingChunks(curThinkingTool) }
                  : {}),
                updatedAt: now,
              })
              ?.catch?.(noop);
            agentFlushLen.set(effectiveMsg.agentId, curText.length);
            agentFlushToolLen.set(effectiveMsg.agentId, curToolLen);
          } else {
            deps.draftStore.touch(userId, threadId, invId)?.catch?.(noop);
          }
          agentFlushTime.set(effectiveMsg.agentId, now);
        }
      }

      if (effectiveMsg.type === 'text' && !effectiveMsg.content) continue;
      // F194 Phase Z9 砚砚 R1 P1-1: stamp ownInvocationId on yielded events
      // (same as route-serial.ts). CLI text/done/tool events don't carry
      // invocationId; only system_info=invocation_created does. Without explicit
      // stamping, downstream broadcaster falls back to parent → multi-turn
      // same-agent under shared parent collapses to one bubble (R13 + R14).
      const ownInvForYield = effectiveMsg.agentId ? agentInvocationId.get(effectiveMsg.agentId) : undefined;
      const stampedEffectiveMsg =
        ownInvForYield && !effectiveMsg.invocationId ? { ...effectiveMsg, invocationId: ownInvForYield } : effectiveMsg;
      yield stampedEffectiveMsg;
    }

    if (msg.type === 'done' && msg.agentId) {
      completedCount++;

      // F148 OQ-2: Log briefing→invocation link + context eval signals
      const doneBriefingId = agentBriefingMessageId.get(msg.agentId);
      const doneInvId = agentInvocationId.get(msg.agentId);
      if (doneBriefingId && doneInvId) {
        const doneCoverage = agentCoverageMap.get(msg.agentId);
        const evalSignals = doneCoverage
          ? extractContextEvalSignals({
              coverageMap: doneCoverage,
              toolNames: agentToolNames.get(msg.agentId) ?? [],
              responseTokenEstimate: estimateTokens(agentText.get(msg.agentId) ?? ''),
            })
          : undefined;
        log.info({
          f148: 'briefing-invocation-link',
          briefingMessageId: doneBriefingId,
          invocationId: doneInvId,
          agentId: msg.agentId,
          threadId,
          hadError: agentHadProviderError.has(msg.agentId),
          ...(evalSignals ? { eval: evalSignals } : {}),
        });
      }

      // F22: Consume MCP-buffered rich blocks BEFORE text/empty branch —
      // blocks must be persisted even when the agent emits no text (cloud Codex P1).
      const ownInvId = agentInvocationId.get(msg.agentId);
      if (ownInvId) completedAgentInvocationIds.push([msg.agentId, ownInvId]);
      // Issue #83 P2 fix: Remove completed agent from keepalive set.
      // Without this, the shared keepalive timer would touch() a deleted draft,
      // recreating an orphan Redis hash key via HSET.
      agentInvocationId.delete(msg.agentId);
      const bufferedBlocks = getRichBlockBuffer().consume(threadId, msg.agentId, ownInvId);
      // #573 parallel variant: socket broadcasts in messages.ts use the OUTER
      // parentInvocationId for live bubble identity. Persist formal messages with
      // the same id; otherwise IDB/live bubbles use parent id while hydration uses
      // per-agent invocation_created id, creating duplicate bubbles after refresh.
      const persistedInvocationId = options.parentInvocationId ?? ownInvId;
      let agentProducedOutput = false;
      const text = agentText.get(msg.agentId);
      if (text) {
        agentProducedOutput = true;
        const meta = agentMeta.get(msg.agentId);
        const sanitized = sanitizeInjectedContent(text);
        // F22: Extract cc_rich blocks from text + merge with buffered
        let { cleanText: storedContent, blocks: textBlocks } = extractRichFromText(sanitized);
        let allRichBlocks = [...bufferedBlocks, ...textBlocks, ...(agentStreamRichBlocks.get(msg.agentId) ?? [])];
        // F34-b: synthesize text-only audio blocks (voice messages)
        // F111: skip synthesis in voiceMode — frontend streams via /api/tts/stream
        if (!voiceMode) {
          const voiceSynth = getVoiceBlockSynthesizer();
          if (voiceSynth && allRichBlocks.some((b) => b.kind === 'audio' && 'text' in b)) {
            try {
              allRichBlocks = await voiceSynth.resolveVoiceBlocks(allRichBlocks, msg.agentId as string);
            } catch (err) {
              log.error({ agentId: msg.agentId, err }, 'Voice block synthesis failed');
            }
          }
        }
        const agentTools = agentToolEvents.get(msg.agentId);
        // F167 L2 AC-A5: parallel mode has no routing semantics, so persist mentions=[]
        // to keep parallel @ mentions out of MessageStore.getMentionsFor() / pending-mentions flow.
        // L2 suppression log below still surfaces the raw @ tokens from the text for observability.

        // F079 Phase 2: Vote interception for parallel routing.
        // @all / multi-agent requests route here, so [VOTE:xxx] must be handled too.
        const votedOption = extractVoteFromText(storedContent);
        if (votedOption && deps.invocationDeps.threadStore) {
          try {
            const voteState = await deps.invocationDeps.threadStore.getVotingState(threadId);
            if (voteState && voteState.status === 'active' && voteState.options.includes(votedOption)) {
              // Parity with HTTP/routeSerial cast validations.
              if (Date.now() > voteState.deadline) {
                log.info({ threadId, votedOption }, 'Vote expired, ignoring');
              } else if (
                voteState.voters &&
                voteState.voters.length > 0 &&
                !voteState.voters.includes(msg.agentId) &&
                msg.agentId !== voteState.initiatedByAgent
              ) {
                log.info({ agentId: msg.agentId, threadId }, 'Not in voters list, ignoring vote');
              } else {
                voteState.votes[msg.agentId] = votedOption;
                await deps.invocationDeps.threadStore.updateVotingState(threadId, voteState);
                log.info({ agentId: msg.agentId, votedOption, threadId }, 'Vote cast');

                if (checkVoteCompletion(voteState)) {
                  const tally = buildVoteTally(voteState.options, voteState.votes);
                  const totalVotes = Object.values(voteState.votes).length;
                  const fields = voteState.options.map((opt) => ({
                    label: opt,
                    value: `${tally[opt] ?? 0} 票 (${totalVotes > 0 ? Math.round(((tally[opt] ?? 0) / totalVotes) * 100) : 0}%)`,
                  }));
                  const richBlock = {
                    id: `vote-${Date.now()}`,
                    kind: 'card' as const,
                    v: 1 as const,
                    title: `投票结果: ${voteState.question}`,
                    bodyMarkdown: voteState.anonymous ? `匿名投票 · ${totalVotes} 票` : `实名投票 · ${totalVotes} 票`,
                    tone: 'info' as const,
                    fields,
                  };
                  await deps.invocationDeps.threadStore.updateVotingState(threadId, null);
                  // F079 Bug 1 fix: do NOT push richBlock into allRichBlocks — that
                  // embeds the result in the agent's own message, causing duplication.
                  // Only the standalone connector message below should carry the result.
                  // Gap 3: persist separate connector message for ConnectorBubble rendering
                  try {
                    const stored = await deps.messageStore.append({
                      userId,
                      agentId: null,
                      content: `投票结果: ${voteState.question}`,
                      mentions: [],
                      timestamp: Date.now(),
                      threadId,
                      source: VOTE_RESULT_SOURCE,
                      extra: { rich: { v: 1 as const, blocks: [richBlock] } },
                    });
                    // F079 Bug 2 fix: broadcast connector_message so frontend updates without F5
                    if (deps.socketManager) {
                      deps.socketManager.broadcastToRoom(`thread:${threadId}`, 'connector_message', {
                        threadId,
                        message: {
                          id: stored.id,
                          type: 'connector',
                          content: stored.content,
                          source: VOTE_RESULT_SOURCE,
                          timestamp: stored.timestamp,
                          extra: stored.extra,
                        },
                      });
                    }
                  } catch (persistErr) {
                    log.warn({ threadId, err: persistErr }, 'Failed to persist vote connector message');
                  }
                  log.info({ threadId }, 'Vote auto-closed');
                }
              }
            }
          } catch (voteErr) {
            log.warn({ agentId: msg.agentId, err: voteErr }, 'Vote interception failed');
          }
        }

        let triagePlanIdsToLink: string[] = [];

        // F229 KD-17: Post-process concierge reply — inject CardBlock actions from HandleMap markers
        if (
          'conciergeConfig' in conciergeCtx &&
          conciergeContextForAgent(conciergeCtx, msg.agentId as string)?.conciergeConfig &&
          deps.invocationDeps.conciergeHandleMapStore &&
          storedContent
        ) {
          try {
            // Phase B: pass triageDeps if TriagePlanStore is available
            const triageDeps: TriagePlanExtractionDeps | undefined = deps.invocationDeps.conciergeTriagePlanStore
              ? {
                  triagePlanStore: deps.invocationDeps.conciergeTriagePlanStore,
                  userId,
                  sourceMessageId: currentUserMessageId ?? `triage-${Date.now()}`,
                  ...(deps.invocationDeps.threadStore
                    ? {
                        targetAgentsResolverDeps: {
                          messageStore: deps.messageStore,
                          threadStore: deps.invocationDeps.threadStore,
                        },
                      }
                    : {}),
                }
              : undefined;
            const conciergeActions = await buildConciergeActions(
              storedContent,
              threadId,
              deps.invocationDeps.conciergeHandleMapStore,
              triageDeps,
            );
            triagePlanIdsToLink = extractTriagePlanIdsFromActions(conciergeActions);
            if (conciergeActions.length > 0) {
              allRichBlocks = [
                ...allRichBlocks,
                {
                  kind: 'card' as const,
                  v: 1 as const,
                  id: `concierge-actions-${Date.now()}`,
                  title: '',
                  actions: conciergeActions,
                },
              ];
              // Strip <!-- triage-plan --> markers from stored content (cloud P2 fix).
              // Users should not see raw HTML comment markers in the concierge panel.
              if (triagePlanIdsToLink.length > 0) {
                storedContent = stripTriagePlanMarkers(storedContent);
              }
            }
          } catch {
            // Fail-open
          }
        }

        const thinking = agentThinking.get(msg.agentId);
        try {
          const storedMsg = await deps.messageStore.append({
            userId,
            agentId: msg.agentId as AgentId,
            content: storedContent,
            mentions: [],
            origin: 'stream',
            timestamp: invocationStartedAt,
            threadId,
            ...(thinking && thinking.length > 0 ? { thinking: renderThinkingChunks(thinking) } : {}),
            ...(meta ? { metadata: meta } : {}),
            ...(agentTools && agentTools.length > 0 ? { toolEvents: agentTools } : {}),
            extra: {
              ...(allRichBlocks.length > 0 ? { rich: { v: 1 as const, blocks: allRichBlocks } } : {}),
              // F194 Phase Z9 AC-Z25 (KD-28): always stamp turnInvocationId
              // (= ownInvId else parent fallback).
              ...(persistedInvocationId
                ? {
                    stream: {
                      invocationId: persistedInvocationId,
                      turnInvocationId: ownInvId ?? persistedInvocationId,
                    },
                  }
                : {}),
              ...(msg.tracing ? { tracing: msg.tracing } : {}),
            },
          });
          const triagePlanStore = deps.invocationDeps.conciergeTriagePlanStore;
          if (triagePlanStore && triagePlanIdsToLink.length > 0) {
            try {
              await Promise.all(
                triagePlanIdsToLink.map((planId) => triagePlanStore.setConfirmationMessageId(planId, storedMsg.id)),
              );
            } catch (err) {
              log.warn({ err, threadId, messageId: storedMsg.id }, 'Failed to link triage plan confirmation message');
            }
          }
          // F088-P3: Stash rich blocks for outbound delivery
          if (options.persistenceContext && allRichBlocks.length > 0) {
            options.persistenceContext.richBlocks = [
              ...(options.persistenceContext.richBlocks ?? []),
              ...allRichBlocks,
            ];
          }
          // #80: Clean up draft only after successful append
          if (deps.draftStore && ownInvId) {
            deps.draftStore.delete(userId, threadId, ownInvId)?.catch?.(noop);
          }
          // Cloud Codex R4 P1 fix: Update activity in isolated try/catch to not affect append status
          if (deps.invocationDeps.threadStore) {
            try {
              await deps.invocationDeps.threadStore.updateParticipantActivity(
                threadId,
                msg.agentId as AgentId,
                // #267: only errors before abort are provider failures
                !agentHadProviderError.has(msg.agentId),
              );
            } catch (activityErr) {
              log.warn({ agentId: msg.agentId, err: activityErr }, 'updateParticipantActivity failed');
            }
          }
        } catch (err) {
          log.error({ agentId: msg.agentId, err }, 'messageStore.append failed, degrading');
          if (options.persistenceContext) {
            options.persistenceContext.failed = true;
            options.persistenceContext.errors.push({
              agentId: msg.agentId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else if (!agentHadError.has(msg.agentId)) {
        // No text content and no error.
        // Persist only when there is non-text payload (tool/thinking/rich).
        // Purely empty turns should not create blank chat bubbles.
        const meta = agentMeta.get(msg.agentId);
        const agentTools = agentToolEvents.get(msg.agentId);
        const thinking = agentThinking.get(msg.agentId);
        const noTextBlocks = [...bufferedBlocks, ...(agentStreamRichBlocks.get(msg.agentId) ?? [])];
        const hasRichBlocks = noTextBlocks.length > 0;
        const sawUserFacingSystemInfo = agentSawUserFacingSystemInfo.get(msg.agentId) === true;
        const shouldPersistNoTextMessage =
          hasRichBlocks ||
          (agentTools?.length ?? 0) > 0 ||
          Boolean(thinking && renderThinkingChunks(thinking).trim().length > 0);
        const shouldEmitSilentCompletion = (agentTools?.length ?? 0) > 0 && !hasRichBlocks && !sawUserFacingSystemInfo;

        // Diagnostic: if agent ran tools but produced no text, emit a system_info so the
        // user sees *something* instead of a silent vanish (bugfix: silent-exit P1).
        if (shouldEmitSilentCompletion) {
          yield {
            type: 'system_info' as AgentMessageType,
            agentId: msg.agentId,
            content: JSON.stringify({
              type: 'silent_completion',
              detail: `${msg.agentId} completed with tool calls but no text response.`,
              toolCount: agentTools?.length ?? 0,
            }),
            timestamp: Date.now(),
          } as AgentMessage;
        }

        if (shouldPersistNoTextMessage || sawUserFacingSystemInfo || shouldEmitSilentCompletion) {
          agentProducedOutput = true;
        }

        if (shouldPersistNoTextMessage) {
          try {
            await deps.messageStore.append({
              userId,
              agentId: msg.agentId as AgentId,
              content: '',
              mentions: [],
              origin: 'stream',
              timestamp: invocationStartedAt,
              threadId,
              ...(thinking && thinking.length > 0 ? { thinking: renderThinkingChunks(thinking) } : {}),
              ...(meta ? { metadata: meta } : {}),
              ...(agentTools && agentTools.length > 0 ? { toolEvents: agentTools } : {}),
              extra: {
                ...(noTextBlocks.length > 0 ? { rich: { v: 1 as const, blocks: noTextBlocks } } : {}),
                // F194 Phase Z3 dual id (see route-serial.ts:1370 for contract)
                // F194 Phase Z9 AC-Z25 (KD-28): always stamp turnInvocationId
                // (= ownInvId else parent fallback) — prevents multi-turn same-agent
                // bubble collapse under shared parent invocation.
                ...(persistedInvocationId
                  ? {
                      stream: {
                        invocationId: persistedInvocationId,
                        turnInvocationId: ownInvId ?? persistedInvocationId,
                      },
                    }
                  : {}),
                ...(msg.tracing ? { tracing: msg.tracing } : {}),
              },
            });
            // F088-P3: Stash rich blocks for outbound delivery (no-text branch)
            if (options.persistenceContext && noTextBlocks.length > 0) {
              options.persistenceContext.richBlocks = [
                ...(options.persistenceContext.richBlocks ?? []),
                ...noTextBlocks,
              ];
            }
            // #80: Clean up draft only after successful append
            if (deps.draftStore && ownInvId) {
              deps.draftStore.delete(userId, threadId, ownInvId)?.catch?.(noop);
            }
            // Cloud Codex R4 P1 fix: Update activity in isolated try/catch to not affect append status
            if (deps.invocationDeps.threadStore) {
              try {
                await deps.invocationDeps.threadStore.updateParticipantActivity(
                  threadId,
                  msg.agentId as AgentId,
                  // #267: only errors before abort are provider failures
                  !agentHadProviderError.has(msg.agentId),
                );
              } catch (activityErr) {
                log.warn({ agentId: msg.agentId, err: activityErr }, 'updateParticipantActivity failed');
              }
            }
          } catch (err) {
            log.error({ agentId: msg.agentId, err }, 'messageStore.append failed, degrading');
            if (options.persistenceContext) {
              options.persistenceContext.failed = true;
              options.persistenceContext.errors.push({
                agentId: msg.agentId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } else if (!sawUserFacingSystemInfo) {
          yield {
            type: 'system_info' as AgentMessageType,
            agentId: msg.agentId,
            content: JSON.stringify({
              type: 'silent_completion',
              detail: `${msg.agentId} completed without textual output.`,
              toolCount: agentToolEvents.get(msg.agentId)?.length ?? 0,
              provider: agentMeta.get(msg.agentId)?.provider,
              model: agentMeta.get(msg.agentId)?.model,
              invocationId: ownInvId,
            }),
            timestamp: Date.now(),
          } as AgentMessage;
          // No persisted message for fully silent turns.
          if (deps.draftStore && ownInvId) {
            deps.draftStore.delete(userId, threadId, ownInvId)?.catch?.(noop);
          }
        } else if (deps.draftStore && ownInvId) {
          deps.draftStore.delete(userId, threadId, ownInvId)?.catch?.(noop);
        }
      } else {
        // hadError but toolEvents exist — persist tool record so refresh shows what was attempted
        const agentTools = agentToolEvents.get(msg.agentId);
        if (agentTools && agentTools.length > 0) {
          const meta = agentMeta.get(msg.agentId);
          const thinking = agentThinking.get(msg.agentId);
          try {
            await deps.messageStore.append({
              userId,
              agentId: msg.agentId as AgentId,
              content: '',
              mentions: [],
              origin: 'stream',
              timestamp: invocationStartedAt,
              threadId,
              ...(thinking && thinking.length > 0 ? { thinking: renderThinkingChunks(thinking) } : {}),
              ...(meta ? { metadata: meta } : {}),
              toolEvents: agentTools,
              ...(persistedInvocationId || msg.tracing
                ? {
                    extra: {
                      // F194 Phase Z9 AC-Z25 (KD-28): always stamp turnInvocationId.
                      ...(persistedInvocationId
                        ? {
                            stream: {
                              invocationId: persistedInvocationId,
                              turnInvocationId: ownInvId ?? persistedInvocationId,
                            },
                          }
                        : {}),
                      ...(msg.tracing ? { tracing: msg.tracing } : {}),
                    },
                  }
                : {}),
            });
            // #80: Clean up draft only after successful append
            if (deps.draftStore && ownInvId) {
              deps.draftStore.delete(userId, threadId, ownInvId)?.catch?.(noop);
            }
            // Cloud Codex R4 P1 fix: Update activity in isolated try/catch to not affect append status
            if (deps.invocationDeps.threadStore) {
              try {
                await deps.invocationDeps.threadStore.updateParticipantActivity(
                  threadId,
                  msg.agentId as AgentId,
                  // #267: only errors before abort are provider failures
                  !agentHadProviderError.has(msg.agentId),
                );
              } catch (activityErr) {
                log.warn({ agentId: msg.agentId, err: activityErr }, 'updateParticipantActivity failed');
              }
            }
          } catch (err) {
            log.error({ agentId: msg.agentId, err }, 'messageStore.append (error+tools) failed, degrading');
            if (options.persistenceContext) {
              options.persistenceContext.failed = true;
              options.persistenceContext.errors.push({
                agentId: msg.agentId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }

      // Persist error as system message so it survives F5 reload but does NOT
      // re-enter the prompt as a agent message (aligned with route-serial.ts).
      // Previously errors were mixed into agentText and persisted with userId=user,
      // which polluted the conversation history and caused "context poisoning".
      const errorText = agentErrorText.get(msg.agentId);
      if (errorText) {
        const cliDiag = agentCliDiagnostics.get(msg.agentId);
        try {
          await deps.messageStore.append({
            userId: 'system',
            agentId: null,
            content: `Error: ${errorText}`,
            mentions: [],
            origin: 'stream',
            timestamp: Date.now(),
            threadId,
            // F212 Phase B (云端 codex P2-8): persist cliDiagnostics for F5 hydration.
            ...(cliDiag ? { metadata: { provider: '', model: '', cliDiagnostics: cliDiag } } : {}),
          });
        } catch (err) {
          log.error({ agentId: msg.agentId, err }, 'messageStore.append (error system msg) failed');
        }
      }

      // F222 Phase B AC-B2: Mirror route-serial's frustration detection for parallel mode.
      // Non-blocking: detection failure must not interrupt the parallel route pipeline.
      // F222 P1: Skip for A2A/connector origins — only detect frustration on user-driven routes.
      if (deps.frustrationIssueStore && options.frustrationAutoIssueEligible !== false) {
        const cliDiag = agentCliDiagnostics.get(msg.agentId);
        try {
          const { evaluate } = await import('../../frustration/FrustrationDetector.js');
          const frustrationDeps = {
            frustrationIssueStore: deps.frustrationIssueStore,
            messageStore: deps.messageStore,
            socketManager: deps.socketManager as
              | import('../../../../../infrastructure/websocket/index.js').SocketManager
              | undefined,
          };

          // Signal 1: CLI error
          if (cliDiag?.reasonCode) {
            await evaluate(
              {
                signal: { type: 'cli_error', diagnostics: cliDiag },
                threadId,
                userId,
                agentId: msg.agentId as string,
              },
              frustrationDeps,
            );
          }

          // Signal 2: Cancel burst (via PendingRequestStore)
          if (deps.pendingRequestStore) {
            const { CANCEL_WINDOW_MS } = await import('../../frustration/FrustrationDetector.js');
            const recentDenied = await deps.pendingRequestStore.listRecentDenied(
              threadId,
              Date.now() - CANCEL_WINDOW_MS,
            );
            if (recentDenied.length >= 3) {
              await evaluate(
                {
                  signal: {
                    type: 'cancel_burst',
                    recentDenials: recentDenied.map((r) => ({
                      action: r.action,
                      timestamp: r.respondedAt ?? r.createdAt,
                    })),
                  },
                  threadId,
                  userId,
                  agentId: msg.agentId as string,
                },
                frustrationDeps,
              );
            }
          }
        } catch {
          // Non-blocking
        }
      }

      // Ack cursor regardless of error: messages were assembled into the prompt
      // and delivered to the agent. Not acking causes infinite re-delivery.
      if (incrementalMode) {
        const boundaryId = boundaryByAgent.get(msg.agentId as AgentId);
        if (boundaryId) {
          if (options.cursorBoundaries) {
            // ADR-008 S3: defer ack — caller acks after invocation succeeds
            upsertMaxBoundary(options.cursorBoundaries, msg.agentId, boundaryId);
          } else if (deps.deliveryCursorStore) {
            // Legacy: ack immediately
            try {
              await deps.deliveryCursorStore.ackCursor(userId, msg.agentId as AgentId, threadId, boundaryId);
            } catch (err) {
              log.error({ agentId: msg.agentId, err }, 'ackCursor failed');
            }
          }
        }
      }

      // F155: Ack guide completion only after agent produced visible output.
      if (deps.invocationDeps.threadStore) {
        const { createGuideStoreBridge } = await import('../../../../guides/GuideSessionRepository.js');
        const sessionStore = deps.invocationDeps.guideSessionStore!;
        await ackGuideCompletion({
          ctx: guideCtx,
          agentId: msg.agentId as string,
          agentProducedOutput,
          targetAgentIds,
          threadId,
          userId,
          guideStore: createGuideStoreBridge(sessionStore),
          threadStore: deps.invocationDeps.threadStore!,
        });
      }

      const isFinal = completedCount === targetAgents.length;

      // F167 L2: parallel 模式 @ 无路由语义（independent thinking），
      // 不 emit a2a_followup_available 提示，避免引导用户/Agent 误以为 @ 真的转移了球权。
      // 若文本里仍出现 @句柄，仅记录 suppressedInParallel 日志用于观测。
      if (isFinal) {
        for (const [cid, text] of agentText.entries()) {
          const ms = parseA2AMentions(text, cid as AgentId);
          if (ms.length > 0) {
            log.info(
              { threadId, agent: cid, suppressedMentions: ms, suppressedInParallel: true },
              'F167 L2: parallel-mode @ mentions suppressed (no routing, no followup hint)',
            );
          }
        }
      }

      // F194 Phase Z9 砚砚 R2 P1: parallel done yield must use the `ownInvId`
      // captured at L808 BEFORE `agentInvocationId.delete(msg.agentId)` at L812.
      // Re-querying the map here returns undefined → done event yielded without
      // invocationId → downstream broadcaster falls back to parent → bubble
      // identity / liveness wrongly attached to parent (instead of own turn).
      const stampedDone = ownInvId && !msg.invocationId ? { ...msg, invocationId: ownInvId } : msg;
      yield { ...stampedDone, isFinal };
      if (isFinal) yieldedFinalDone = true;
    }
  }

  // F153: Set route aggregate attributes on the parent route span
  if (options.routeSpan) {
    options.routeSpan.setAttribute(ROUTE_TOTAL_AGENTS_INVOKED, completedCount);
    options.routeSpan.setAttribute(ROUTE_TOTAL_TOKENS, routeTotalTokens);
    // Parallel routes never produce A2A handoffs (MVP safety boundary)
    options.routeSpan.setAttribute(ROUTE_HAS_A2A_HANDOFF, false);
  }

  // F200 AC-A1: fire-and-forget recall correlation after all agents complete
  if (deps.toolEventLog && deps.evidenceStore && completedAgentInvocationIds.length > 0) {
    const evidenceDb = (deps.evidenceStore as { getDb?: () => import('better-sqlite3').Database }).getDb?.();
    if (evidenceDb) {
      deps.toolEventLog
        .readByThread(threadId)
        .then((events) => {
          const raw = events as unknown as Parameters<typeof triggerRecallCorrelation>[1];
          for (const [agentId, invId] of completedAgentInvocationIds) {
            triggerRecallCorrelation(evidenceDb, raw, invId, agentId).catch(() => {});
          }
        })
        .catch(() => {});
    }
  }

  // done-guarantee safety net: synthesize final done if loop exited without one
  if (!yieldedFinalDone && targetAgents.length > 0) {
    yield {
      type: 'done' as AgentMessageType,
      agentId: targetAgents[targetAgents.length - 1]!,
      isFinal: true,
      timestamp: Date.now(),
    } as AgentMessage;
  }

  // Issue #83: Stop keepalive timer — streaming loop has exited.
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = undefined;
  }
}
