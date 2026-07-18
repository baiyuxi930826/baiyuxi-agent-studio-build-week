'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgentData } from '@/hooks/useAgentData';
import { apiFetch } from '@/utils/api-client';
import { ClientStep, type DetectedClient } from './first-run-quest/ClientStep';
import { ConfigStep } from './first-run-quest/ConfigStep';
import { type TemplateCard, TemplateStep } from './first-run-quest/TemplateStep';

type WizardStep = 'template' | 'client' | 'config' | 'creating' | 'done';

interface FirstRunQuestWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: (questThreadId: string, agentName: string) => void;
}

const STEP_TITLES: Record<WizardStep, string> = {
  template: '第 1 步 — 选择角色模板',
  client: '第 2 步 — 选择客户端',
  config: '第 3 步 — 配置认证和模型',
  creating: '创建中...',
  done: '完成！',
};

export function FirstRunQuestWizard({ open, onClose, onCreated }: FirstRunQuestWizardProps) {
  const { refresh } = useAgentData();
  const [step, setStep] = useState<WizardStep>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateCard | null>(null);
  const [selectedClient, setSelectedClient] = useState<DetectedClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track created agent to avoid orphans on thread-creation retry
  const createdAgentRef = useRef<{ id: string; name: string } | null>(null);

  // Reset wizard state when reopening modal
  useEffect(() => {
    if (open) {
      setStep('template');
      setSelectedTemplate(null);
      setSelectedClient(null);
      setError(null);
      createdAgentRef.current = null;
    }
  }, [open]);

  const handleTemplateSelect = useCallback((template: TemplateCard) => {
    setSelectedTemplate(template);
    createdAgentRef.current = null; // invalidate — inputs changed
    setStep('client');
  }, []);

  const handleClientSelect = useCallback((client: DetectedClient) => {
    setSelectedClient(client);
    createdAgentRef.current = null; // invalidate — inputs changed
    setStep('config');
  }, []);

  const handleConfigComplete = useCallback(
    async (config: { accountRef: string; model: string }) => {
      if (!selectedTemplate || !selectedClient) return;
      setStep('creating');
      setError(null);
      try {
        // Reuse previously created agent if thread creation failed on a prior attempt
        let createdAgentId: string;
        let createdAgentName: string;

        if (createdAgentRef.current) {
          createdAgentId = createdAgentRef.current.id;
          createdAgentName = createdAgentRef.current.name;
          // Reconcile config: if user changed accountRef/model since the agent was
          // created, PATCH the existing agent so the bound config stays in sync.
          const patchRes = await apiFetch(`/api/agents/${encodeURIComponent(createdAgentId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accountRef: config.accountRef,
              defaultModel: config.model,
            }),
          });
          if (!patchRes.ok) throw new Error('Agent 配置更新失败');
        } else {
          const suffix = Date.now().toString(36).slice(-4);
          const agentId = `${selectedTemplate.id}-${suffix}`;
          const agentName = selectedTemplate.nickname ?? selectedTemplate.name;

          const createRes = await apiFetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId,
              name: selectedTemplate.name,
              displayName: selectedTemplate.name,
              nickname: selectedTemplate.nickname,
              avatar: selectedTemplate.avatar,
              color: selectedTemplate.color,
              mentionPatterns: [
                ...(selectedTemplate.nickname ? [`@${selectedTemplate.nickname}`] : []),
                `@${selectedTemplate.name}`,
              ],
              roleDescription: selectedTemplate.roleDescription,
              personality: selectedTemplate.personality,
              teamStrengths: selectedTemplate.teamStrengths,
              clientId: selectedClient.provider,
              accountRef: config.accountRef,
              defaultModel: config.model,
            }),
          });

          if (!createRes.ok) {
            const body = (await createRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `创建失败 (${createRes.status})`);
          }

          const agentBody = (await createRes.json()) as { agent?: { id: string; displayName: string } };
          createdAgentId = agentBody.agent?.id ?? agentId;
          createdAgentName = agentBody.agent?.displayName ?? agentName;
          createdAgentRef.current = { id: createdAgentId, name: createdAgentName };

          await refresh();
        }

        // Create bootcamp thread at phase-1-intro (wizard already handled agent selection).
        const bootcampRes = await apiFetch('/api/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '🎓 Agent 新手工作流',
            bootcampState: {
              v: 1,
              phase: 'phase-1-intro',
              leadAgent: createdAgentId,
              startedAt: Date.now(),
            },
          }),
        });

        if (!bootcampRes.ok) {
          throw new Error('创建训练营线程失败');
        }

        const thread = (await bootcampRes.json()) as { id: string };

        setStep('done');
        onCreated(thread.id, createdAgentName);
      } catch (err) {
        setError(err instanceof Error ? err.message : '创建失败');
        setStep('config');
      }
    },
    [selectedTemplate, selectedClient, onCreated, refresh],
  );

  if (!open) return null;

  const canGoBack = step === 'client' || step === 'config';

  const handleBack = () => {
    if (step === 'config') setStep('client');
    else if (step === 'client') setStep('template');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--console-overlay-medium)] px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl border border-conn-amber-ring bg-[var(--console-card-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--semantic-warning-surface)] px-6 py-4">
          <div className="flex items-center gap-3">
            {canGoBack && (
              <button
                type="button"
                onClick={handleBack}
                className="text-sm text-studio-muted hover:text-studio-secondary"
              >
                ← 上一步
              </button>
            )}
            <h3 className="text-base font-semibold text-studio">{STEP_TITLES[step]}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-studio-muted hover:text-studio-secondary"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded-lg border border-conn-red-ring bg-conn-red-bg p-3 text-sm text-conn-red-text">
              {error}
            </div>
          )}

          {step === 'template' && <TemplateStep onSelect={handleTemplateSelect} />}
          {step === 'client' && <ClientStep onSelect={handleClientSelect} />}
          {step === 'config' && selectedClient && (
            <ConfigStep
              client={selectedClient.client}
              clientId={selectedClient.provider}
              onComplete={handleConfigComplete}
            />
          )}
          {step === 'creating' && (
            <div className="flex flex-col items-center py-12">
              <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-conn-amber-ring border-t-amber-600" />
              <p className="text-sm text-studio-muted">正在创建你的第一个能力通道...</p>
            </div>
          )}
          {step === 'done' && (
            <div className="flex flex-col items-center py-12">
              <div className="mb-3 text-4xl">🎉</div>
              <p className="text-base font-semibold text-studio">能力通道已就位！</p>
              <p className="mt-1 text-sm text-studio-muted">正在跳转到教程线程...</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
