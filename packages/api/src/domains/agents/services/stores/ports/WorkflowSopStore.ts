import type { UpdateWorkflowSopInput, WorkflowSop } from '@agent-studio/shared';

export class VersionConflictError extends Error {
  readonly currentState: WorkflowSop;
  constructor(current: WorkflowSop) {
    super(`Version conflict: expected ${current.version - 1}, actual ${current.version}`);
    this.name = 'VersionConflictError';
    this.currentState = current;
  }
}

export interface IWorkflowSopStore {
  get(backlogItemId: string): Promise<WorkflowSop | null>;
  upsert(
    backlogItemId: string,
    featureId: string,
    input: UpdateWorkflowSopInput,
    updatedBy: string,
  ): Promise<WorkflowSop>;
  delete(backlogItemId: string): Promise<boolean>;
}
