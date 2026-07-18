// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(testDir, '..', '..', '..');
const agentHueInjectorPath = resolve(webRoot, 'src', 'components', 'AgentHueInjector.tsx');
const tailwindConfigPath = resolve(webRoot, 'tailwind.config.js');

describe('kimi theme regression', () => {
  it('AgentHueInjector generates tokens dynamically for ALL agents (no hardcoded slug map)', () => {
    const src = readFileSync(agentHueInjectorPath, 'utf8');
    // Post-Option B: no hardcoded AGENT_ID_TO_SLUG mapping — all agents get tokens via agent.id
    expect(src).not.toMatch(/AGENT_ID_TO_SLUG/);
    // Dynamic injection uses agent.id directly as CSS key
    expect(src).toContain('agent.id');
    expect(src).toContain('hexToOklch');
    // No legacy compat layer needed — runtime agentId is already the short name
    expect(src).not.toMatch(/legacyAlias/);
    // No hardcoded old purple hex
    expect(src).not.toContain('#7c3aed');
  });

  it('exports a kimi color family in tailwind so sidebar/session-chain classes compile', async () => {
    const configModule = await import(tailwindConfigPath);
    const config = configModule.default ?? configModule;
    expect(config.theme.extend.colors.kimi).toEqual({
      primary: 'var(--color-kimi-primary)',
      light: 'var(--color-kimi-light)',
      dark: 'var(--color-kimi-dark)',
      bg: 'var(--color-kimi-bg)',
    });
  });
});
