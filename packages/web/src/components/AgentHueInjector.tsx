'use client';

/**
 * F056 Phase E2b — Agent Persona hue/chroma injector (all-dynamic)
 *
 * Reads agent catalog primary hex → computes OKLCH hue/chroma → injects
 * :root CSS vars + generates full --color-{agentId}-* derivation rules for
 * ALL agents dynamically. No static per-agent CSS rules needed.
 *
 * agent.id at runtime is the resolved agentId (e.g. "opus", "codex", "gemini"),
 * NOT the template variant id (e.g. "opus-default"). Resolution happens in
 * agent-config-loader.ts: `variant.agentId ?? role.agentId`.
 *
 * Truth source (KD-25): agent-template.json (seed) + .agent-studio/agent-catalog.json
 * (overlay), via /api/agents → useAgentData hook.
 */

import { getAllConnectorDefinitions } from '@agent-studio/shared';
import { useEffect } from 'react';
import { useAgentData } from '@/hooks/useAgentData';
import { hexToOklch } from '@/lib/color-utils';

const DYNAMIC_STYLE_ID = 'f056-dynamic-agent-tokens';
const CSS_SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/* Both light and dark use the same formula, just with different fallback L/Cmul
 * values. Tuner emits :root + [data-theme="dark"] overrides for the --agent-{tier}-
 * L/Cmul vars, so the dark fallbacks below only kick in when Tuner hasn't run
 * (SSR or no localStorage state). The hue/chroma are per-agent from AgentHueInjector. */
function lightDecl(id: string): string {
  return (
    `--color-${id}-bubble:oklch(var(--agent-bubble-l, 0.62) calc(var(--${id}-chroma) * var(--agent-bubble-cmul, 1)) var(--${id}-hue));` +
    `--color-${id}-surface:oklch(var(--agent-surface-l, 0.85) calc(var(--${id}-chroma) * var(--agent-surface-cmul, 0.45)) var(--${id}-hue));` +
    `--color-${id}-text:oklch(var(--agent-name-l, 0.15) var(--agent-name-c, 0.025) var(--agent-name-h, 5));` +
    `--color-${id}-ring:oklch(var(--agent-ring-l, 0.55) calc(var(--${id}-chroma) * var(--agent-ring-cmul, 1.1)) var(--${id}-hue));` +
    `--color-${id}-primary:var(--color-${id}-bubble);` +
    `--color-${id}-light:var(--color-${id}-surface);` +
    `--color-${id}-dark:var(--color-${id}-text);` +
    `--color-${id}-bg:var(--color-${id}-surface);`
  );
}

function darkDecl(id: string): string {
  return (
    `--color-${id}-bubble:oklch(var(--agent-bubble-l, 0.68) calc(var(--${id}-chroma) * var(--agent-bubble-cmul, 0.85)) var(--${id}-hue));` +
    `--color-${id}-surface:oklch(var(--agent-surface-l, 0.3) calc(var(--${id}-chroma) * var(--agent-surface-cmul, 0.15)) var(--${id}-hue));` +
    `--color-${id}-text:oklch(var(--agent-name-l, 0.95) var(--agent-name-c, 0.1) var(--agent-name-h, 25));` +
    `--color-${id}-ring:oklch(var(--agent-ring-l, 0.70) calc(var(--${id}-chroma) * var(--agent-ring-cmul, 1)) var(--${id}-hue));`
  );
}

export function AgentHueInjector() {
  const { agents } = useAgentData();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const ruleIds: string[] = [];

    for (const agent of agents) {
      if (!agent.id || !CSS_SAFE_ID.test(agent.id)) continue;
      let h = 0;
      let c = 0;
      if (agent.color?.primary) {
        try {
          const oklch = hexToOklch(agent.color.primary);
          if (Number.isFinite(oklch.h) && Number.isFinite(oklch.c)) {
            h = oklch.h;
            c = oklch.c;
          }
        } catch {
          /* Invalid hex → neutral fallback (h=0 c=0) so tokens still exist */
        }
      }
      root.style.setProperty(`--${agent.id}-hue`, h.toFixed(1));
      root.style.setProperty(`--${agent.id}-chroma`, c.toFixed(3));
      ruleIds.push(agent.id);
    }

    /* Connector sources use the same pipeline as agents: one theme hex →
     * hexToOklch → hue/chroma → lightDecl/darkDecl derives all tiers. */
    for (const def of getAllConnectorDefinitions()) {
      if (!def.id || !CSS_SAFE_ID.test(def.id)) continue;
      if (ruleIds.includes(def.id)) continue;
      const hex = def.themeColor;
      let h = 0;
      let c = 0;
      if (hex) {
        try {
          const oklch = hexToOklch(hex);
          if (Number.isFinite(oklch.h) && Number.isFinite(oklch.c)) {
            h = oklch.h;
            c = oklch.c;
          }
        } catch {
          /* neutral fallback */
        }
      }
      root.style.setProperty(`--${def.id}-hue`, h.toFixed(1));
      root.style.setProperty(`--${def.id}-chroma`, c.toFixed(3));
      ruleIds.push(def.id);
    }

    /* Generate dynamic token stylesheet for ALL agents + connector sources. */
    let styleEl = document.getElementById(DYNAMIC_STYLE_ID) as HTMLStyleElement | null;
    if (ruleIds.length === 0) {
      if (styleEl) styleEl.textContent = '';
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = DYNAMIC_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    const lightRules = ruleIds.map(lightDecl).join('');
    const darkRules = ruleIds.map(darkDecl).join('');
    styleEl.textContent = `:root{${lightRules}}\n[data-theme="dark"]{${darkRules}}`;
  }, [agents]);

  return null;
}
