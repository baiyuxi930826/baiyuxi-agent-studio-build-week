/**
 * F153: mention_dispatch span for callback A2A paths.
 *
 * Creates a dispatch span as child of the caller's trace context,
 * returning a new CallerTraceContext for the dispatched route.
 */

import { context as ctxApi, trace } from '@opentelemetry/api';
import type { CallerTraceContext } from './genai-semconv.js';
import { AGENT_ID } from './genai-semconv.js';
import { a2aDispatchCount } from './instruments.js';

const tracer = trace.getTracer('agent-studio-a2a');

export function wrapWithDispatchSpan(
  callerCtx: CallerTraceContext,
  targetCount: number,
  sourceAgentId?: string,
): CallerTraceContext {
  const remoteParent = trace.setSpanContext(ctxApi.active(), {
    traceId: callerCtx.traceId,
    spanId: callerCtx.spanId,
    traceFlags: callerCtx.traceFlags,
    isRemote: true,
  });

  const dispatchSpan = tracer.startSpan(
    'agent_studio.mention_dispatch',
    { attributes: { 'dispatch.target_count': targetCount, 'dispatch.source': 'callback' } },
    remoteParent,
  );

  // F153 Phase I: counter for Step Summary aggregate; only AGENT_ID attribute when known.
  a2aDispatchCount.add(1, sourceAgentId ? { [AGENT_ID]: sourceAgentId } : {});

  const sc = dispatchSpan.spanContext();
  dispatchSpan.end();

  return { traceId: sc.traceId, spanId: sc.spanId, traceFlags: sc.traceFlags };
}
