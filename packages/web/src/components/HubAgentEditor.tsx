'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentData } from '@/hooks/useAgentData';
import { apiFetch } from '@/utils/api-client';
import type { ConfigData } from './config-viewer-types';
import type { TemplateCard } from './first-run-quest/TemplateStep';
import type { AccountsResponse, ProfileItem } from './hub-accounts.types';
import { uploadAvatarAsset, uploadRefAudioAsset } from './hub-agent-editor.client';
import {
  autoSlug,
  buildAgentPatchPayload,
  buildAgentPayload,
  buildCodexConfigPatches,
  buildStrategyPayload,
  builtinAccountIdForClient,
  type CodexRuntimeSettings,
  DEFAULT_ANTIGRAVITY_COMMAND_ARGS,
  filterAccounts,
  type HubAgentEditorDraft,
  type HubAgentEditorFormState,
  initialState,
  joinTags,
  normalizeMentionPattern,
  type StrategyFormState,
  splitMentionPatterns,
  toCodexRuntimeSettings,
  toStrategyForm,
  withDefaultModelMentionPattern,
} from './hub-agent-editor.model';
import { AccountSection, IdentitySection, RoutingSection } from './hub-agent-editor.sections';
import { AdvancedRuntimeSection } from './hub-agent-editor-advanced';
import { PersistenceBanner } from './hub-agent-editor-fields';
import type { AgentStrategyEntry } from './hub-strategy-types';
import { useConfirm } from './useConfirm';

interface HubAgentEditorProps {
  agent?: AgentData | null;
  draft?: HubAgentEditorDraft | null;
  /** All agents — used for alias uniqueness validation. */
  existingAgents?: AgentData[];
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function HubAgentEditor({ agent, draft, existingAgents, open, onClose, onSaved }: HubAgentEditorProps) {
  const confirm = useConfirm();
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [loadingCodexSettings, setLoadingCodexSettings] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [codexSettingsError, setCodexSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<HubAgentEditorFormState>(() => initialState(agent, draft));
  const [strategyForm, setStrategyForm] = useState<StrategyFormState | null>(null);
  const [strategyBaseline, setStrategyBaseline] = useState<StrategyFormState | null>(null);
  const [strategyBaselineHasOverride, setStrategyBaselineHasOverride] = useState(false);
  const [codexSettings, setCodexSettings] = useState<CodexRuntimeSettings | null>(null);
  const [codexSettingsBaseline, setCodexSettingsBaseline] = useState<CodexRuntimeSettings | null>(null);
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>('custom');

  const availableProfiles = useMemo(() => filterAccounts(form.clientId, profiles), [form.clientId, profiles]);
  const selectedProfile = useMemo(
    () => availableProfiles.find((profile) => profile.id === form.accountRef) ?? null,
    [availableProfiles, form.accountRef],
  );
  const modelOptions = useMemo(() => {
    if (form.clientId === 'antigravity') return [];
    return selectedProfile?.models ?? [];
  }, [form.clientId, selectedProfile]);
  const showCodexSettings = form.clientId === 'openai';
  const codexSettingsEditable = !showCodexSettings || codexSettingsBaseline !== null;

  // Alias uniqueness: collect all patterns from OTHER agents (lowercase for comparison)
  const reservedPatterns = useMemo(() => {
    if (!existingAgents?.length) return new Set<string>();
    const editingId = agent?.id;
    const set = new Set<string>();
    for (const c of existingAgents) {
      if (c.id === editingId) continue;
      for (const p of c.mentionPatterns) set.add(p.toLowerCase());
    }
    return set;
  }, [existingAgents, agent?.id]);

  useEffect(() => {
    if (!open) return;
    setForm(initialState(agent, draft));
    setFieldErrors({});
    setError(null);
    setStrategyError(null);
    setCodexSettingsError(null);
    setStrategyBaselineHasOverride(false);
    setCodexSettingsBaseline(null);
    setSelectedTemplateId('custom');
    setHasUnsavedChanges(false);
  }, [open, agent, draft]);

  // Re-fetch profiles when Provider Profiles page creates/saves/deletes an account.
  const [profilesVersion, setProfilesVersion] = useState(0);
  useEffect(() => {
    const handler = () => setProfilesVersion((v) => v + 1);
    window.addEventListener('accounts-changed', handler);
    return () => window.removeEventListener('accounts-changed', handler);
  }, []);

  useEffect(() => {
    if (!open || agent) {
      setTemplates([]);
      return;
    }
    let cancelled = false;
    apiFetch('/api/agent-templates')
      .then(async (res) => {
        if (!res.ok) throw new Error('load failed');
        return (await res.json()) as { templates?: TemplateCard[] };
      })
      .then((body) => {
        if (!cancelled) setTemplates(body.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, agent]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingProfiles(true);
    apiFetch('/api/accounts')
      .then(async (res) => {
        if (!res.ok) throw new Error(`账号配置加载失败 (${res.status})`);
        return (await res.json()) as AccountsResponse;
      })
      .then((body) => {
        if (!cancelled) setProfiles(body.providers);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '账号配置加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingProfiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, profilesVersion]);

  useEffect(() => {
    if (!open || !agent) {
      setStrategyForm(null);
      setStrategyBaseline(null);
      setStrategyBaselineHasOverride(false);
      setLoadingStrategy(false);
      return;
    }
    let cancelled = false;
    setStrategyForm(null);
    setStrategyBaseline(null);
    setLoadingStrategy(true);
    apiFetch('/api/config/session-strategy')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Session 策略加载失败 (${res.status})`);
        return (await res.json()) as { agents?: AgentStrategyEntry[] };
      })
      .then((body) => {
        if (cancelled) return;
        const entry = body.agents?.find((item) => item.agentId === agent.id) ?? null;
        const nextStrategyForm = entry ? toStrategyForm(entry) : null;
        setStrategyForm(nextStrategyForm);
        setStrategyBaseline(nextStrategyForm);
        setStrategyBaselineHasOverride(Boolean(entry?.hasOverride));
      })
      .catch((err) => {
        if (!cancelled) setStrategyError(err instanceof Error ? err.message : 'Session 策略加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingStrategy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, agent]);

  useEffect(() => {
    if (!open || !showCodexSettings) {
      setCodexSettings(null);
      setCodexSettingsBaseline(null);
      setLoadingCodexSettings(false);
      return;
    }
    let cancelled = false;
    setLoadingCodexSettings(true);
    Promise.resolve()
      .then(() => apiFetch('/api/config'))
      .then(async (res) => {
        if (!res.ok) throw new Error(`Codex 运行参数加载失败 (${res.status})`);
        return (await res.json()) as { config?: ConfigData };
      })
      .then((body) => {
        if (cancelled) return;
        const next = toCodexRuntimeSettings(body.config);
        setCodexSettings(next);
        setCodexSettingsBaseline(next);
      })
      .catch((err) => {
        if (!cancelled) {
          const fallback = toCodexRuntimeSettings();
          setCodexSettings((prev) => prev ?? fallback);
          setCodexSettingsError(err instanceof Error ? err.message : 'Codex 运行参数加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCodexSettings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, open, showCodexSettings]);

  useEffect(() => {
    if (form.clientId === 'antigravity') {
      setForm((prev) => (prev.accountRef === '' ? prev : { ...prev, accountRef: '' }));
      return;
    }
    setForm((prev) => {
      if (prev.accountRef.trim().length === 0 && (agent || !draft)) {
        return prev;
      }
      if (availableProfiles.length === 0) return prev;
      const preferredBuiltin = builtinAccountIdForClient(prev.clientId);
      const nextProfile =
        availableProfiles.find((profile) => profile.id === prev.accountRef) ??
        (preferredBuiltin ? availableProfiles.find((profile) => profile.id === preferredBuiltin) : null) ??
        availableProfiles[0] ??
        null;
      if (!nextProfile) return prev;
      if (prev.accountRef === nextProfile.id) return prev;
      return { ...prev, accountRef: nextProfile.id };
    });
  }, [availableProfiles, agent, draft, form.clientId]);

  // Auto-fill first available model only on profile/client change — NOT when
  // the user clears the field. Previous code had form.defaultModel in deps,
  // which re-filled immediately after the user cleared the input (#802).
  useEffect(() => {
    if (form.clientId === 'antigravity' || modelOptions.length === 0) return;
    setForm((prev) => {
      if (prev.clientId === 'antigravity' || prev.defaultModel.trim().length > 0) return prev;
      return { ...prev, defaultModel: modelOptions[0] ?? '' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // excludes form.defaultModel: auto-fill runs on profile change, not on
    // user clearing the model input.
  }, [form.clientId, modelOptions]);

  useEffect(() => {
    if (form.clientId !== 'antigravity') return;
    if (form.commandArgs.trim().length > 0) return;
    setForm((prev) => {
      if (prev.clientId !== 'antigravity') return prev;
      if (prev.commandArgs.trim().length > 0) return prev;
      return { ...prev, commandArgs: DEFAULT_ANTIGRAVITY_COMMAND_ARGS };
    });
  }, [form.clientId, form.commandArgs]);

  if (!open) return null;

  const saveBlockedByProfileBinding = false;

  const patchForm = (patch: Partial<HubAgentEditorFormState>) => {
    setHasUnsavedChanges(true);
    setForm((prev) => ({ ...prev, ...patch }));
    if (patch.mentionPatterns !== undefined) {
      setFieldErrors((prev) => ({ ...prev, routing: false }));
    }
    if (patch.name !== undefined || patch.roleDescription !== undefined) {
      setFieldErrors((prev) => ({ ...prev, identity: false }));
    }
    if (patch.defaultModel !== undefined || patch.clientId !== undefined) {
      setFieldErrors((prev) => ({ ...prev, account: false }));
    }
  };
  const patchStrategy = (patch: Partial<StrategyFormState>) => {
    setHasUnsavedChanges(true);
    setStrategyForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };
  const patchCodex = (patch: Partial<CodexRuntimeSettings>) => {
    setHasUnsavedChanges(true);
    setCodexSettings((prev) => ({
      ...(prev ?? toCodexRuntimeSettings()),
      ...patch,
    }));
  };

  const handleTemplateSelect = (t: TemplateCard | null) => {
    if (!t) {
      setSelectedTemplateId('custom');
      setForm(initialState(null, null));
      setHasUnsavedChanges(false);
      return;
    }
    setSelectedTemplateId(t.id);
    const name = t.name;
    const agentId = autoSlug(name);
    // Auto-suffix aliases that conflict with existing agents
    const rawAliases = [t.nickname, name].filter((s): s is string => Boolean(s));
    const deduped = rawAliases.map((alias) => {
      const normalized = normalizeMentionPattern(alias);
      if (!reservedPatterns.has(normalized.toLowerCase())) return normalized;
      for (let i = 2; i <= 99; i++) {
        const candidate = normalizeMentionPattern(`${alias}${i}`);
        if (!reservedPatterns.has(candidate.toLowerCase())) return candidate;
      }
      return normalized; // fallback — backend will catch it
    });
    patchForm({
      name,
      displayName: name,
      nickname: t.nickname ?? '',
      avatar: t.avatar ?? '',
      colorPrimary: t.color.primary,
      colorSecondary: t.color.secondary,
      roleDescription: t.roleDescription,
      personality: t.personality,
      teamStrengths: t.teamStrengths ?? '',
      agentId,
      mentionPatterns: joinTags(deduped),
    });
  };

  const requestClose = async () => {
    if (!hasUnsavedChanges) {
      onClose();
      return;
    }
    if (await confirm({ title: '关闭确认', message: '有未保存的修改，确定要关闭吗？' })) onClose();
  };

  const handleAvatarUpload = async (file: File) => {
    setUploadingAvatar(true);
    setError(null);
    try {
      patchForm({ avatar: await uploadAvatarAsset(file) });
    } catch (err) {
      setError(err instanceof Error ? err.message : '头像上传失败');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRefAudioUpload = async (file: File) => {
    setError(null);
    await uploadRefAudioAsset(file).then(
      (result) => patchForm({ voiceRefAudio: result.url }),
      (err) => setError(err instanceof Error ? err.message : '参考音频上传失败'),
    );
  };

  const handleSave = async () => {
    if (uploadingAvatar) {
      setError('头像上传中，请等待完成后再保存');
      return;
    }
    const errors: Record<string, boolean> = {};
    const errorMessages: string[] = [];
    // Create-only pre-flight: existing agents already passed backend validation.
    if (!agent) {
      if (!form.name.trim()) {
        errors.identity = true;
        errorMessages.push('名称');
      }
      if (!form.roleDescription.trim()) {
        errors.identity = true;
        errorMessages.push('角色描述');
      }
      if (!form.defaultModel.trim() && selectedProfile?.authType === 'api_key') {
        errors.account = true;
        errorMessages.push('Model');
      } else if (
        form.clientId === 'opencode' &&
        selectedProfile?.authType === 'api_key' &&
        !form.provider.trim() &&
        (() => {
          const m = form.defaultModel.trim();
          const si = m.indexOf('/');
          const looksLike = si > 0 && si < m.length - 1;
          if (!looksLike) return true; // bare model, need provider
          // Known provider prefix → canonical (synced with BUILTIN_OPENCODE_PROVIDERS)
          const known = new Set(['anthropic', 'openai', 'openrouter', 'google']);
          if (known.has(m.slice(0, si))) return false;
          // Non-builtin: "x/y" in account list + bare "y" absent → namespace
          const acm = selectedProfile?.models ?? [];
          const bare = m.slice(si + 1);
          return acm.includes(m) && !acm.includes(bare);
        })()
      ) {
        errors.account = true;
        errorMessages.push('请使用 provider/model 格式（如 minimax/MiniMax-M2.7），或填写 Provider 名称');
      }
      const effectiveCreateForm = selectedProfile?.authType === 'api_key' ? withDefaultModelMentionPattern(form) : form;
      if (splitMentionPatterns(effectiveCreateForm.mentionPatterns).length === 0) {
        errors.routing = true;
        errorMessages.push('别名');
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(`请填写必填字段：${errorMessages.join('、')}`);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setError(null);
    const rollbackSteps: Array<() => Promise<void>> = [];
    const rollbackMutations = async () => {
      for (const rollback of rollbackSteps.reverse()) {
        await rollback().catch(() => {});
      }
    };
    try {
      const effectiveForm =
        !agent && selectedProfile?.authType === 'api_key' ? withDefaultModelMentionPattern(form) : form;
      const agentPayload = agent
        ? buildAgentPatchPayload(effectiveForm, agent)
        : buildAgentPayload(effectiveForm, agent);
      const rollbackAgentPayload = agent ? buildAgentPayload(initialState(agent, null), agent) : null;
      const strategyEditable = Boolean(
        agent && form.sessionChain === 'true' && (strategyForm?.sessionChainEnabled ?? true),
      );
      const nextStrategyPayload = strategyEditable && strategyForm ? buildStrategyPayload(strategyForm) : null;
      const baselineStrategyPayload =
        strategyEditable && strategyBaseline ? buildStrategyPayload(strategyBaseline) : null;
      const strategyChanged =
        agent && nextStrategyPayload && strategyEditable
          ? JSON.stringify(nextStrategyPayload) !== JSON.stringify(baselineStrategyPayload)
          : false;

      if (agent && strategyChanged && nextStrategyPayload) {
        const strategyRes = await apiFetch(`/api/config/session-strategy/${agent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextStrategyPayload),
        });
        if (!strategyRes.ok) {
          const payload = (await strategyRes.json().catch(() => ({}))) as Record<string, unknown>;
          setError((payload.error as string) ?? `Session 策略保存失败 (${strategyRes.status})`);
          return;
        }
        if (strategyBaselineHasOverride && baselineStrategyPayload) {
          rollbackSteps.push(async () => {
            await apiFetch(`/api/config/session-strategy/${agent.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(baselineStrategyPayload),
            });
          });
        } else {
          rollbackSteps.push(async () => {
            await apiFetch(`/api/config/session-strategy/${agent.id}`, {
              method: 'DELETE',
            });
          });
        }
      }

      const res = await apiFetch(agent ? `/api/agents/${agent.id}` : '/api/agents', {
        method: agent ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentPayload),
      });
      if (!res.ok) {
        await rollbackMutations();
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setError((payload.error as string) ?? `保存失败 (${res.status})`);
        return;
      }
      const persistedAgentBody = (await res.json().catch(() => ({}))) as { agent?: { id?: string } };
      const persistedAgentId = persistedAgentBody.agent?.id ?? agent?.id ?? null;
      if (persistedAgentId) {
        if (agent && rollbackAgentPayload) {
          rollbackSteps.push(async () => {
            await apiFetch(`/api/agents/${persistedAgentId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(rollbackAgentPayload),
            });
          });
        } else if (!agent) {
          rollbackSteps.push(async () => {
            await apiFetch(`/api/agents/${persistedAgentId}`, {
              method: 'DELETE',
            });
          });
        }
      }

      if (showCodexSettings && codexSettings && codexSettingsBaseline) {
        const codexPatches = buildCodexConfigPatches(codexSettings, codexSettingsBaseline);
        const rollbackCodexPatches = buildCodexConfigPatches(codexSettingsBaseline, codexSettings);
        const appliedConfigPatchKeys: string[] = [];
        for (const patch of codexPatches) {
          const configRes = await apiFetch('/api/config', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
          if (!configRes.ok) {
            const appliedRollbackPatches = rollbackCodexPatches.filter((rollbackPatch) =>
              appliedConfigPatchKeys.includes(rollbackPatch.key),
            );
            for (const rollbackPatch of appliedRollbackPatches.reverse()) {
              await apiFetch('/api/config', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rollbackPatch),
              }).catch(() => {});
            }
            await rollbackMutations();
            const payload = (await configRes.json().catch(() => ({}))) as Record<string, unknown>;
            setError((payload.error as string) ?? `Codex 运行参数保存失败 (${configRes.status})`);
            return;
          }
          appliedConfigPatchKeys.push(patch.key);
        }
      }

      await onSaved();
      window.dispatchEvent(new CustomEvent('guide:confirm', { detail: { target: 'member-editor.profile' } }));
      onClose();
    } catch (err) {
      await rollbackMutations();
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--console-overlay-medium)] px-4 backdrop-blur-sm"
      onClick={requestClose}
      data-bootcamp-host="agent-editor-modal"
    >
      <div
        className="member-editor-modal flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] bg-[var(--console-card-bg)] shadow-[0_22px_48px_rgba(43,33,26,0.13)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-editor-title"
        data-guide-id="member-editor.profile"
        onClick={(event) => event.stopPropagation()}
        data-bootcamp-step="agent-editor"
      >
        <div className="flex shrink-0 items-start justify-between px-7 py-5">
          <p id="member-editor-title" className="text-compact font-extrabold text-[var(--console-modal-title)]">
            {agent ? agent.displayName || agent.name || agent.id : '添加成员'}
          </p>
          <button
            type="button"
            onClick={requestClose}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--console-modal-close-bg)] text-lg font-extrabold leading-none text-[var(--console-modal-close-fg)] transition hover:opacity-80"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-7 py-5">
          {!agent && templates.length > 0 && (
            <section
              data-guide-id="add-member.template-picker"
              className="space-y-3 rounded-[18px] bg-[var(--console-card-bg)] p-[18px] shadow-[0_8px_22px_rgba(43,33,26,0.04)]"
            >
              <h4 className="text-base font-extrabold text-studio">成员模板</h4>
              <p className="text-xs font-semibold text-studio-secondary">
                从内置成员模板开始，选择后自动填充身份、模型与运行时默认值。
              </p>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => handleTemplateSelect(null)}
                  className={`h-8 rounded-2xl px-3.5 text-compact font-extrabold transition ${
                    selectedTemplateId === 'custom'
                      ? 'bg-[var(--studio-accent)] text-[var(--studio-surface)]'
                      : 'bg-[var(--console-field-bg)] text-[var(--console-template-text)]'
                  }`}
                >
                  自定义
                </button>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTemplateSelect(selectedTemplateId === t.id ? null : t)}
                    className={`h-8 rounded-2xl px-3.5 text-compact font-extrabold transition ${
                      selectedTemplateId === t.id
                        ? 'bg-[var(--studio-accent)] text-[var(--studio-surface)]'
                        : 'bg-[var(--console-field-bg)] text-[var(--console-template-text)]'
                    }`}
                  >
                    {t.nickname ?? t.name}
                  </button>
                ))}
              </div>
            </section>
          )}
          <IdentitySection
            agent={agent}
            form={form}
            hasError={fieldErrors.identity}
            avatarUploading={uploadingAvatar}
            onChange={patchForm}
            onAvatarUpload={handleAvatarUpload}
            onRefAudioUpload={handleRefAudioUpload}
          />
          <AccountSection
            form={form}
            hasError={fieldErrors.account}
            modelOptions={modelOptions}
            availableProfiles={availableProfiles}
            loadingProfiles={loadingProfiles}
            onChange={patchForm}
          />
          <RoutingSection
            form={form}
            hasError={fieldErrors.routing}
            reservedPatterns={reservedPatterns}
            onChange={patchForm}
          />
          <AdvancedRuntimeSection
            agent={agent}
            form={form}
            strategyForm={strategyForm}
            loadingStrategy={loadingStrategy}
            strategyError={strategyError}
            codexSettings={codexSettings}
            loadingCodexSettings={loadingCodexSettings}
            codexSettingsError={codexSettingsError}
            codexSettingsEditable={codexSettingsEditable}
            showCodexSettings={showCodexSettings}
            onChange={patchForm}
            onStrategyChange={patchStrategy}
            onCodexChange={patchCodex}
          />
          <PersistenceBanner />
          {error ? <p className="rounded-2xl bg-conn-red-bg px-4 py-3 text-sm text-conn-red-text">{error}</p> : null}
        </div>

        <div className="flex items-center justify-end px-7 pb-5 pt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploadingAvatar || saveBlockedByProfileBinding}
            className="h-8 rounded-[10px] bg-[var(--studio-accent)] px-4 text-compact font-extrabold text-[var(--studio-surface)] transition hover:bg-[var(--studio-accent-hover)] disabled:opacity-50"
          >
            {saving ? '保存中…' : uploadingAvatar ? '头像上传中...' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
