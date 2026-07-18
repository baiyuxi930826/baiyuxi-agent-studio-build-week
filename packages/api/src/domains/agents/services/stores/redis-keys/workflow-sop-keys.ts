export const WorkflowSopKeys = {
  detail: (backlogItemId: string) => `workflow:sop:${backlogItemId}`,
} as const;
