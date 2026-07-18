'use client';

const QUEST_STEP_LABELS: Record<string, string> = {
  'quest-0-welcome': '欢迎',
  'quest-1-create-first-agent': '创建能力通道',
  'quest-2-agent-intro': 'Agent自我介绍',
  'quest-3-task-select': '选择任务',
  'quest-4-task-running': '执行任务中',
  'quest-5-error-encountered': '发现问题',
  'quest-6-second-agent-prompt': '添加 Review 角色',
  'quest-7-second-agent-created': '第二个角色就位',
  'quest-8-collaboration-demo': '多角色协作',
  'quest-9-completion': '教程完成',
};

const TOTAL_STEPS = 10;

interface QuestBannerProps {
  phase: string;
  firstAgentName?: string;
  onAddSecondAgent?: () => void;
  onStartBootcamp?: () => void;
  onComplete?: () => void;
}

export function QuestBanner({
  phase,
  firstAgentName,
  onAddSecondAgent,
  onStartBootcamp,
  onComplete,
}: QuestBannerProps) {
  const stepIndex = parseInt(phase.split('-')[1] ?? '0', 10);
  const progress = Math.min(((stepIndex + 1) / TOTAL_STEPS) * 100, 100);
  const label = QUEST_STEP_LABELS[phase] ?? phase;
  const isErrorPhase = phase === 'quest-5-error-encountered' || phase === 'quest-6-second-agent-prompt';
  const isComplete = phase === 'quest-9-completion';

  return (
    <div className="mx-4 mb-3 rounded-xl border border-conn-amber-ring bg-conn-amber-bg/80 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-conn-amber-text">新手教程</span>
        <span className="text-xs text-conn-amber-text">{label}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--semantic-warning-surface)]">
        <div
          className="h-full rounded-full bg-[var(--semantic-warning)] transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {phase === 'quest-2-agent-intro' && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-conn-amber-text">
            在下方输入框 @{firstAgentName ?? 'Agent'} 打个招呼，让它自我介绍一下吧！
          </p>
          <p className="text-xs text-conn-amber-text">
            打完招呼后，可以开始新手训练营，跟着 {firstAgentName ?? 'Agent'} 完成第一个协作任务。
          </p>
          {onStartBootcamp && (
            <button
              type="button"
              onClick={onStartBootcamp}
              className="rounded-lg bg-[var(--semantic-warning)] px-3 py-1.5 text-sm font-medium text-[var(--studio-surface)] transition hover:opacity-90"
            >
              开始新手训练营
            </button>
          )}
        </div>
      )}

      {phase === 'quest-3-task-select' && (
        <p className="mt-2 text-xs text-conn-amber-text">
          {'试着给 '}
          {firstAgentName ?? 'Agent'}
          {' 派一个简单任务，比如「帮我写一个 hello world」。'}
        </p>
      )}

      {phase === 'quest-4-task-running' && (
        <p className="mt-2 text-xs text-conn-amber-text">{firstAgentName ?? 'Agent'} 正在执行任务，请耐心等待...</p>
      )}

      {isErrorPhase && (
        <div className="mt-3 rounded-lg border border-[var(--semantic-warning)] bg-[var(--semantic-warning-surface)] p-3">
          <p className="text-sm text-conn-amber-text">
            {firstAgentName ?? 'Agent'} 遇到了一些问题！在真实团队中，我们会让另一个角色来帮忙 review。
          </p>
          {onAddSecondAgent && (
            <button
              type="button"
              onClick={onAddSecondAgent}
              className="mt-2 rounded-lg bg-[var(--semantic-warning)] px-3 py-1.5 text-sm font-medium text-[var(--studio-surface)] transition hover:opacity-90"
            >
              添加一个 Review 角色！
            </button>
          )}
        </div>
      )}

      {isComplete && (
        <div className="mt-3 rounded-lg border border-conn-green-ring bg-conn-green-bg p-3">
          <p className="text-sm text-conn-green-text">恭喜！你已掌握了多角色协作的基本技能。</p>
          {onComplete && (
            <button
              type="button"
              onClick={onComplete}
              className="mt-2 rounded-lg bg-conn-green-text px-3 py-1.5 text-sm font-medium text-[var(--studio-surface)] transition hover:bg-conn-green-hover"
            >
              前往 Console 管理更多角色
            </button>
          )}
        </div>
      )}
    </div>
  );
}
