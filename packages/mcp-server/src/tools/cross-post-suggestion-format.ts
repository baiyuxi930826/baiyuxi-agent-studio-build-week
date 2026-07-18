import type { SuggestedCrossPostAction } from '@agent-studio/shared';

export function formatSuggestedCrossPostActionLines(
  action: SuggestedCrossPostAction,
  opts: {
    indent: string;
    detailIndent: string;
  },
): string[] {
  if (action.type !== 'cross_post') return [];
  if (!action.threadId && !action.targetAgents?.length && !action.ownerAgentId) return [];

  const threadId = action.threadId ?? '<feature-thread-id>';
  const args = [`threadId="${threadId}"`];
  if (action.targetAgents?.length) args.push(`targetAgents=${JSON.stringify(action.targetAgents)}`);

  const contentPlaceholder = action.targetAgents?.length ? '...' : '@target-agent\\n...';
  const lines = [
    `${opts.indent}suggested_action: agent_studio_cross_post_message(${args.join(', ')}, content="${contentPlaceholder}")`,
  ];

  if (!action.targetAgents?.length) {
    lines.push(`${opts.detailIndent}routing: replace @target-agent with the agent handle to wake in the target thread`);
  }
  if (!action.threadId) {
    lines.push(`${opts.detailIndent}routing: find the feature thread before sending`);
  }
  if (action.reason) lines.push(`${opts.detailIndent}reason: ${action.reason}`);
  return lines;
}
