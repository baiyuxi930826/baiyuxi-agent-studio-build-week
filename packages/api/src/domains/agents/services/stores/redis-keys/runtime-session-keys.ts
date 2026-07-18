/**
 * Redis key patterns for RuntimeSessionStore.
 * F211 Phase A1: runtime-session metadata sidecar.
 *
 * Note: agent-studio: prefix is auto-added by ioredis keyPrefix.
 * All keys here are bare (without prefix).
 */

import type {
  RuntimeSessionLifecycleState,
  RuntimeSessionMetadata,
  RuntimeSessionRuntime,
  RuntimeSessionSurface,
} from '../../runtime-session/RuntimeSessionMetadata.js';

export const RuntimeSessionKeys = {
  /** String JSON: RuntimeSessionMetadata sidecar by SessionRecord.id */
  detail: (sessionId: string) => `runtime-session:${sessionId}`,
  /** String: runtime + runtimeSessionId -> SessionRecord.id */
  byRuntime: (runtime: RuntimeSessionRuntime, runtimeSessionId: string) =>
    `runtime-session:runtime:${runtime}:${runtimeSessionId}`,
  /** String: runtime + threadId + agentId -> active SessionRecord.id */
  byThreadAgent: (runtime: RuntimeSessionRuntime, threadId: string, agentId: RuntimeSessionMetadata['agentId']) =>
    `runtime-session-active:${runtime}:${threadId}:${agentId}`,
  /** Sorted Set: lifecycle state -> SessionRecord.id, score = lifecycle.lastObservedAt */
  byLifecycleState: (state: RuntimeSessionLifecycleState) => `runtime-session:lifecycle:${state}`,
  /** Sorted Set: runtime -> SessionRecord.id, score = lifecycle.lastObservedAt */
  recentByRuntime: (runtime: RuntimeSessionRuntime) => `runtime-session:recent:${runtime}`,
  /** Sorted Set: runtime + surface -> SessionRecord.id, score = lifecycle.lastObservedAt */
  recentByRuntimeSurface: (runtime: RuntimeSessionRuntime, surface: RuntimeSessionSurface) =>
    `runtime-session:recent:${runtime}:${surface}`,
  /** Sorted Set: runtime + surface + agentId -> SessionRecord.id, score = lifecycle.lastObservedAt */
  recentByRuntimeSurfaceAgent: (
    runtime: RuntimeSessionRuntime,
    surface: RuntimeSessionSurface,
    agentId: RuntimeSessionMetadata['agentId'],
  ) => `runtime-session:recent:${runtime}:${surface}:${agentId}`,
};
