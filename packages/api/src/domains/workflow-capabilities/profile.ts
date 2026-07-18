export type WorkflowCapabilityCategory =
  | 'model_integration'
  | 'agent_orchestration'
  | 'knowledge_retrieval'
  | 'observability'
  | 'governance'
  | 'delivery';

export type WorkflowCapabilityMaturity = 'implemented' | 'operational' | 'documented';

export interface WorkflowCapability {
  id: string;
  category: WorkflowCapabilityCategory;
  name: string;
  maturity: WorkflowCapabilityMaturity;
  implementation: string;
  evidencePaths: string[];
  capabilitySignals: string[];
}

export interface WorkflowGuardrail {
  id: string;
  name: string;
  control: string;
  evidencePaths: string[];
}

export interface WorkflowObservabilitySignal {
  id: string;
  name: string;
  measures: string[];
  evidencePaths: string[];
}

export interface WorkflowCapabilityProfile {
  schemaVersion: '2026-07-06';
  project: {
    name: 'Baiyuxi Agent Studio';
    repository: 'https://github.com/baiyuxi930826/baiyuxi-agent-studio-build-week';
    positioning: string;
  };
  stack: {
    frontend: string[];
    backend: string[];
    storage: string[];
    aiWorkflow: string[];
    operations: string[];
  };
  capabilities: WorkflowCapability[];
  observability: WorkflowObservabilitySignal[];
  guardrails: WorkflowGuardrail[];
  verification: {
    build: string;
    apiTests: string;
    publicGate: string;
  };
}

export interface WorkflowCapabilitySummary {
  capabilityCount: number;
  categories: Record<WorkflowCapabilityCategory, number>;
  evidencePathCount: number;
}

const capabilities: WorkflowCapability[] = [
  {
    id: 'multi-agent-routing',
    category: 'agent_orchestration',
    name: 'Configurable multi-agent routing',
    maturity: 'implemented',
    implementation:
      'Routes work across task, review, interface, and research capability channels with explicit mentions, queueing, invocation records, and callback surfaces.',
    evidencePaths: [
      'packages/api/src/domains/agents/services/agents/AgentRouter.ts',
      'packages/api/src/routes/queue.ts',
      'packages/api/src/routes/invocations.ts',
      'packages/shared/src/registry/AgentRegistry.ts',
    ],
    capabilitySignals: [
      'Agent orchestration',
      'tool calling',
      'multi-turn decision loops',
      'human-agent collaboration',
    ],
  },
  {
    id: 'model-runtime-integration',
    category: 'model_integration',
    name: 'Multi-provider model runtime integration',
    maturity: 'implemented',
    implementation:
      'Resolves runtime accounts and agent bindings for Codex, Claude, Gemini, Kimi, OpenCode, Dare, and Antigravity-style providers behind a shared invocation layer.',
    evidencePaths: [
      'packages/api/src/config/account-resolver.ts',
      'packages/api/src/config/agent-account-binding.ts',
      'packages/api/src/domains/agents/services/agents/invocation/InvocationRegistry.ts',
      'packages/api/src/domains/agents/services/agents/providers',
    ],
    capabilitySignals: ['OpenAI/Claude-style integration', 'model routing', 'production API boundaries'],
  },
  {
    id: 'sse-normalizing-proxy',
    category: 'model_integration',
    name: 'SSE-compatible upstream proxy',
    maturity: 'operational',
    implementation:
      'Normalizes streaming upstream responses, retries transient provider failures, preserves identity encoding, and rewrites usage fields for downstream parsers.',
    evidencePaths: ['scripts/anthropic-proxy.mjs', 'scripts/check-env-example.test.mjs'],
    capabilitySignals: ['SSE streaming', 'LLM API integration', 'fallback handling', 'token usage extraction'],
  },
  {
    id: 'memory-recall-evaluation',
    category: 'knowledge_retrieval',
    name: 'Memory recall metrics and trajectory evaluation',
    maturity: 'implemented',
    implementation:
      'Computes recall coverage, dormant anchors, cross-agent metrics, trajectory verification signals, and thread-scoped recall event history.',
    evidencePaths: [
      'packages/api/src/routes/recall-metrics.ts',
      'packages/api/src/domains/memory/RecallMetricsComputer.ts',
      'packages/api/src/domains/memory/CrossAgentMetricsComputer.ts',
      'docs/features/F200-memory-recall-eval.md',
    ],
    capabilitySignals: ['RAG evaluation', 'Golden Set thinking', 'quality drift monitoring', 'knowledge retrieval'],
  },
  {
    id: 'workflow-telemetry',
    category: 'observability',
    name: 'Workflow telemetry and health surfaces',
    maturity: 'implemented',
    implementation:
      'Exposes trace queries, step summaries, Prometheus metrics, metrics history, readiness aggregation, and recent invocation error-rate health checks.',
    evidencePaths: [
      'packages/api/src/routes/telemetry.ts',
      'packages/api/src/infrastructure/telemetry',
      'packages/api/src/routes/usage.ts',
      'packages/api/src/domains/agents/services/usage-aggregator.ts',
    ],
    capabilitySignals: [
      'workflow observability',
      'latency monitoring',
      'token cost tracking',
      'degraded health states',
    ],
  },
  {
    id: 'guarded-review-gates',
    category: 'governance',
    name: 'Guarded review and merge gates',
    maturity: 'documented',
    implementation:
      'Defines review-only roles, local quality gates, merge gates, release provenance, public sync rules, and explicit approval for side-effect actions.',
    evidencePaths: [
      'docs/SOP.md',
      'agent-studio-skills/quality-gate/SKILL.md',
      'agent-studio-skills/merge-gate/SKILL.md',
      'AGENTS.md',
    ],
    capabilitySignals: ['Guardrails', 'HITL', 'code review', 'safe production workflow'],
  },
  {
    id: 'workspace-delivery-loop',
    category: 'delivery',
    name: 'Local-first delivery loop',
    maturity: 'operational',
    implementation:
      'Combines workspace file access, terminal control, preview gateway, service lifecycle endpoints, Git operations, and desktop packaging for end-to-end delivery.',
    evidencePaths: [
      'packages/api/src/routes/workspace.ts',
      'packages/api/src/routes/terminal.ts',
      'packages/api/src/routes/preview.ts',
      'desktop/service-manager.js',
    ],
    capabilitySignals: ['full-stack delivery', 'container/runtime operations', 'developer workflow automation'],
  },
];

const observability: WorkflowObservabilitySignal[] = [
  {
    id: 'token-cost',
    name: 'Token and cost aggregation',
    measures: ['inputTokens', 'outputTokens', 'cacheReadTokens', 'costUsd', 'daily agent participation'],
    evidencePaths: ['packages/api/src/domains/agents/services/usage-aggregator.ts', 'packages/api/src/routes/usage.ts'],
  },
  {
    id: 'trace-step-summary',
    name: 'Trace and step summary',
    measures: ['trace spans', 'route step counts', 'provider markers', 'readiness checks'],
    evidencePaths: [
      'packages/api/src/routes/telemetry.ts',
      'packages/api/src/infrastructure/telemetry/step-summary.ts',
    ],
  },
  {
    id: 'recall-quality',
    name: 'Recall quality signals',
    measures: ['recall events', 'trajectory verification', 'cross-agent recall coverage', 'dormant anchors'],
    evidencePaths: ['packages/api/src/routes/recall-metrics.ts', 'docs/features/F200-memory-recall-eval.md'],
  },
];

const guardrails: WorkflowGuardrail[] = [
  {
    id: 'human-approval',
    name: 'Human approval for side effects',
    control:
      'Side-effect actions such as public publish, remote sync, and approval-gated workflow steps require explicit operator confirmation.',
    evidencePaths: ['docs/SOP.md', 'agent-studio-skills/merge-gate/SKILL.md'],
  },
  {
    id: 'reviewer-separation',
    name: 'Reviewer separation',
    control: 'The author of a change is not the sole reviewer; reviewer roles are separated from implementation roles.',
    evidencePaths: ['AGENTS.md', 'docs/SOP.md'],
  },
  {
    id: 'privacy-boundary',
    name: 'Privacy and credential boundary',
    control:
      'Repository documentation and runtime conventions avoid committing credentials, private URLs, and raw operational secrets.',
    evidencePaths: ['SECURITY.md', 'AGENTS.md'],
  },
];

export function buildWorkflowCapabilityProfile(): WorkflowCapabilityProfile {
  return {
    schemaVersion: '2026-07-06',
    project: {
      name: 'Baiyuxi Agent Studio',
      repository: 'https://github.com/baiyuxi930826/baiyuxi-agent-studio-build-week',
      positioning:
        'A local-first AI workflow workbench for multi-agent engineering, memory recall, observable model invocation, and human-reviewed delivery.',
    },
    stack: {
      frontend: ['Next.js', 'React', 'TypeScript', 'Zustand', 'TanStack Query', 'Tailwind CSS'],
      backend: ['Node.js', 'Fastify', 'TypeScript', 'WebSocket', 'SSE-compatible proxy', 'MCP surfaces'],
      storage: ['SQLite', 'Redis-compatible runtime state', 'file-backed project memory'],
      aiWorkflow: ['multi-agent routing', 'tool invocation', 'memory recall', 'telemetry', 'review gates'],
      operations: ['pnpm monorepo', 'Docker-ready service lifecycle', 'GitHub workflow gates', 'desktop packaging'],
    },
    capabilities,
    observability,
    guardrails,
    verification: {
      build: 'pnpm --filter @agent-studio/api run build',
      apiTests:
        'pnpm --filter @agent-studio/api exec node ./scripts/run-node-test-suite.mjs test/workflow-capabilities.test.js',
      publicGate: 'pnpm --filter @agent-studio/api run test:public',
    },
  };
}

export function summarizeWorkflowCapabilityProfile(profile: WorkflowCapabilityProfile): WorkflowCapabilitySummary {
  const categories = {
    model_integration: 0,
    agent_orchestration: 0,
    knowledge_retrieval: 0,
    observability: 0,
    governance: 0,
    delivery: 0,
  } satisfies Record<WorkflowCapabilityCategory, number>;

  const evidencePaths = new Set<string>();
  for (const capability of profile.capabilities) {
    categories[capability.category] += 1;
    for (const path of capability.evidencePaths) evidencePaths.add(path);
  }
  for (const item of profile.observability) {
    for (const path of item.evidencePaths) evidencePaths.add(path);
  }
  for (const item of profile.guardrails) {
    for (const path of item.evidencePaths) evidencePaths.add(path);
  }

  return {
    capabilityCount: profile.capabilities.length,
    categories,
    evidencePathCount: evidencePaths.size,
  };
}
