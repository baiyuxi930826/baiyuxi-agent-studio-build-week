import assert from 'node:assert/strict';
import { chmodSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

describe('MCP callback tools: agent-key support', () => {
  const savedEnv = {};

  function setEnv(vars) {
    for (const [k, v] of Object.entries(vars)) {
      savedEnv[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it('getCallbackConfig returns agent-key config when only AGENT_STUDIO_AGENT_KEY_SECRET is set', async () => {
    setEnv({
      AGENT_STUDIO_API_URL: 'http://localhost:3004',
      AGENT_STUDIO_INVOCATION_ID: undefined,
      AGENT_STUDIO_CALLBACK_TOKEN: undefined,
      AGENT_STUDIO_AGENT_KEY_SECRET: 'ak-secret-test',
      AGENT_STUDIO_AGENT_KEY_FILE: undefined,
      AGENT_STUDIO_AGENT_KEY_FILES: undefined,
    });
    // Dynamic import to pick up env
    const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
    const config = mod.getCallbackConfig();
    assert.ok(config, 'config should not be null');
    assert.equal(config.agentKeySecret, 'ak-secret-test');
    assert.equal(config.invocationId, undefined);
  });

  it('buildAuthHeaders returns x-agent-key-secret when no invocation creds', async () => {
    const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
    const headers = mod.buildAuthHeaders({
      apiUrl: 'http://localhost:3004',
      agentKeySecret: 'ak-secret-test',
    });
    assert.equal(headers['x-agent-key-secret'], 'ak-secret-test');
    assert.equal(headers['x-invocation-id'], undefined);
  });

  it('buildAuthHeaders prefers invocation creds over agent-key', async () => {
    const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
    const headers = mod.buildAuthHeaders({
      apiUrl: 'http://localhost:3004',
      invocationId: 'inv-1',
      callbackToken: 'tok-1',
      agentKeySecret: 'ak-secret-test',
    });
    assert.equal(headers['x-invocation-id'], 'inv-1');
    assert.equal(headers['x-callback-token'], 'tok-1');
    assert.equal(headers['x-agent-key-secret'], undefined);
  });

  it('getCallbackConfig rejects partial invocation creds (P2 — only invocationId, no token)', async () => {
    setEnv({
      AGENT_STUDIO_API_URL: 'http://localhost:3004',
      AGENT_STUDIO_INVOCATION_ID: 'inv-orphan',
      AGENT_STUDIO_CALLBACK_TOKEN: undefined,
      AGENT_STUDIO_AGENT_KEY_SECRET: undefined,
      AGENT_STUDIO_AGENT_KEY_FILE: undefined,
      AGENT_STUDIO_AGENT_KEY_FILES: undefined,
    });
    const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
    const config = mod.getCallbackConfig();
    assert.equal(config, null, 'partial invocation creds (only invocationId) must return null');
  });

  it('getCallbackConfig rejects partial invocation creds (P2 — only token, no invocationId)', async () => {
    setEnv({
      AGENT_STUDIO_API_URL: 'http://localhost:3004',
      AGENT_STUDIO_INVOCATION_ID: undefined,
      AGENT_STUDIO_CALLBACK_TOKEN: 'tok-orphan',
      AGENT_STUDIO_AGENT_KEY_SECRET: undefined,
      AGENT_STUDIO_AGENT_KEY_FILE: undefined,
      AGENT_STUDIO_AGENT_KEY_FILES: undefined,
    });
    const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
    const config = mod.getCallbackConfig();
    assert.equal(config, null, 'partial invocation creds (only callbackToken) must return null');
  });

  it('getCallbackConfig accepts partial invocation when agent-key fallback exists', async () => {
    setEnv({
      AGENT_STUDIO_API_URL: 'http://localhost:3004',
      AGENT_STUDIO_INVOCATION_ID: 'inv-with-fallback',
      AGENT_STUDIO_CALLBACK_TOKEN: undefined,
      AGENT_STUDIO_AGENT_KEY_SECRET: 'ak-fallback',
      AGENT_STUDIO_AGENT_KEY_FILE: undefined,
      AGENT_STUDIO_AGENT_KEY_FILES: undefined,
    });
    const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
    const config = mod.getCallbackConfig();
    assert.ok(config, 'should return config when agent-key fallback exists');
    assert.equal(config.agentKeySecret, 'ak-fallback');
    assert.equal(config.invocationId, undefined, 'partial invocation should be stripped');
  });

  it('reads secret from AGENT_STUDIO_AGENT_KEY_FILE when env var not set', async () => {
    const tmpFile = join(tmpdir(), `agent-key-test-${Date.now()}.secret`);
    writeFileSync(tmpFile, 'sidecar-secret-value\n', { mode: 0o600 });
    try {
      setEnv({
        AGENT_STUDIO_API_URL: 'http://localhost:3004',
        AGENT_STUDIO_INVOCATION_ID: undefined,
        AGENT_STUDIO_CALLBACK_TOKEN: undefined,
        AGENT_STUDIO_AGENT_KEY_SECRET: undefined,
        AGENT_STUDIO_AGENT_KEY_FILE: tmpFile,
        AGENT_STUDIO_AGENT_KEY_FILES: undefined,
      });
      const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
      const config = mod.getCallbackConfig();
      assert.ok(config, 'config should not be null');
      assert.equal(config.agentKeySecret, 'sidecar-secret-value');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('env var AGENT_STUDIO_AGENT_KEY_SECRET takes precedence over sidecar file', async () => {
    const tmpFile = join(tmpdir(), `agent-key-test-prec-${Date.now()}.secret`);
    writeFileSync(tmpFile, 'file-secret\n', { mode: 0o600 });
    try {
      setEnv({
        AGENT_STUDIO_API_URL: 'http://localhost:3004',
        AGENT_STUDIO_INVOCATION_ID: undefined,
        AGENT_STUDIO_CALLBACK_TOKEN: undefined,
        AGENT_STUDIO_AGENT_KEY_SECRET: 'env-secret',
        AGENT_STUDIO_AGENT_KEY_FILE: tmpFile,
        AGENT_STUDIO_AGENT_KEY_FILES: undefined,
      });
      const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
      const config = mod.getCallbackConfig();
      assert.ok(config);
      assert.equal(config.agentKeySecret, 'env-secret');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('reads variant-scoped secret from AGENT_STUDIO_AGENT_KEY_FILES when agentKeyAgentId is requested', async () => {
    const antigravityFile = join(tmpdir(), `agent-key-antigravity-${Date.now()}.secret`);
    const antigOpusFile = join(tmpdir(), `agent-key-antig-opus-${Date.now()}.secret`);
    writeFileSync(antigravityFile, 'gemini-secret\n', { mode: 0o600 });
    writeFileSync(antigOpusFile, 'claude-secret\n', { mode: 0o600 });
    try {
      setEnv({
        AGENT_STUDIO_API_URL: 'http://localhost:3004',
        AGENT_STUDIO_INVOCATION_ID: undefined,
        AGENT_STUDIO_CALLBACK_TOKEN: undefined,
        AGENT_STUDIO_AGENT_KEY_SECRET: undefined,
        AGENT_STUDIO_AGENT_KEY_FILE: antigravityFile,
        AGENT_STUDIO_AGENT_KEY_FILES: JSON.stringify({
          antigravity: antigravityFile,
          'antig-opus': antigOpusFile,
        }),
      });
      const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
      const config = mod.getCallbackConfig({ agentKeyAgentId: 'antig-opus' });
      assert.ok(config);
      assert.equal(config.agentKeySecret, 'claude-secret');
    } finally {
      unlinkSync(antigravityFile);
      unlinkSync(antigOpusFile);
    }
  });

  it('rejects explicit agentKeyAgentId when AGENT_STUDIO_AGENT_KEY_FILES is missing instead of falling back', async () => {
    const defaultFile = join(tmpdir(), `agent-key-default-${Date.now()}.secret`);
    writeFileSync(defaultFile, 'default-secret\n', { mode: 0o600 });
    try {
      setEnv({
        AGENT_STUDIO_API_URL: 'http://localhost:3004',
        AGENT_STUDIO_INVOCATION_ID: undefined,
        AGENT_STUDIO_CALLBACK_TOKEN: undefined,
        AGENT_STUDIO_AGENT_KEY_SECRET: undefined,
        AGENT_STUDIO_AGENT_KEY_FILE: defaultFile,
        AGENT_STUDIO_AGENT_KEY_FILES: undefined,
      });
      const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
      const config = mod.getCallbackConfig({ agentKeyAgentId: 'antig-opus' });
      assert.equal(config, null, 'explicit variant identity must not fall back to default agent key');
    } finally {
      unlinkSync(defaultFile);
    }
  });

  it('rejects explicit agentKeyAgentId when the variant map omits that agent', async () => {
    const defaultFile = join(tmpdir(), `agent-key-default-${Date.now()}.secret`);
    const antigravityFile = join(tmpdir(), `agent-key-antigravity-${Date.now()}.secret`);
    writeFileSync(defaultFile, 'default-secret\n', { mode: 0o600 });
    writeFileSync(antigravityFile, 'gemini-secret\n', { mode: 0o600 });
    try {
      setEnv({
        AGENT_STUDIO_API_URL: 'http://localhost:3004',
        AGENT_STUDIO_INVOCATION_ID: undefined,
        AGENT_STUDIO_CALLBACK_TOKEN: undefined,
        AGENT_STUDIO_AGENT_KEY_SECRET: undefined,
        AGENT_STUDIO_AGENT_KEY_FILE: defaultFile,
        AGENT_STUDIO_AGENT_KEY_FILES: JSON.stringify({ antigravity: antigravityFile }),
      });
      const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
      const config = mod.getCallbackConfig({ agentKeyAgentId: 'antig-opus' });
      assert.equal(config, null, 'missing requested variant must fail closed');
    } finally {
      unlinkSync(defaultFile);
      unlinkSync(antigravityFile);
    }
  });

  it('rejects explicit agentKeyAgentId when AGENT_STUDIO_AGENT_KEY_FILES is invalid JSON', async () => {
    const defaultFile = join(tmpdir(), `agent-key-default-${Date.now()}.secret`);
    writeFileSync(defaultFile, 'default-secret\n', { mode: 0o600 });
    try {
      setEnv({
        AGENT_STUDIO_API_URL: 'http://localhost:3004',
        AGENT_STUDIO_INVOCATION_ID: undefined,
        AGENT_STUDIO_CALLBACK_TOKEN: undefined,
        AGENT_STUDIO_AGENT_KEY_SECRET: undefined,
        AGENT_STUDIO_AGENT_KEY_FILE: defaultFile,
        AGENT_STUDIO_AGENT_KEY_FILES: '{not-json',
      });
      const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
      const config = mod.getCallbackConfig({ agentKeyAgentId: 'antig-opus' });
      assert.equal(config, null, 'invalid variant map must fail closed for explicit variant identity');
    } finally {
      unlinkSync(defaultFile);
    }
  });

  it('rejects omitted agentKeyAgentId when a shared variant key map exists', async () => {
    const defaultFile = join(tmpdir(), `agent-key-default-${Date.now()}.secret`);
    const antigravityFile = join(tmpdir(), `agent-key-antigravity-${Date.now()}.secret`);
    const antigOpusFile = join(tmpdir(), `agent-key-antig-opus-${Date.now()}.secret`);
    writeFileSync(defaultFile, 'default-secret\n', { mode: 0o600 });
    writeFileSync(antigravityFile, 'gemini-secret\n', { mode: 0o600 });
    writeFileSync(antigOpusFile, 'claude-secret\n', { mode: 0o600 });
    try {
      setEnv({
        AGENT_STUDIO_API_URL: 'http://localhost:3004',
        AGENT_STUDIO_INVOCATION_ID: undefined,
        AGENT_STUDIO_CALLBACK_TOKEN: undefined,
        AGENT_STUDIO_AGENT_KEY_SECRET: undefined,
        AGENT_STUDIO_AGENT_KEY_FILE: defaultFile,
        AGENT_STUDIO_AGENT_KEY_FILES: JSON.stringify({
          antigravity: antigravityFile,
          'antig-opus': antigOpusFile,
        }),
      });
      const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
      const config = mod.getCallbackConfig();
      assert.equal(config, null, 'shared Antigravity MCP must require agentKeyAgentId instead of using default key');
    } finally {
      unlinkSync(defaultFile);
      unlinkSync(antigravityFile);
      unlinkSync(antigOpusFile);
    }
  });

  it('rejects omitted agentKeyAgentId in shared variant mode even when legacy env secret exists', async () => {
    const antigravityFile = join(tmpdir(), `agent-key-antigravity-${Date.now()}.secret`);
    const antigOpusFile = join(tmpdir(), `agent-key-antig-opus-${Date.now()}.secret`);
    writeFileSync(antigravityFile, 'gemini-secret\n', { mode: 0o600 });
    writeFileSync(antigOpusFile, 'claude-secret\n', { mode: 0o600 });
    try {
      setEnv({
        AGENT_STUDIO_API_URL: 'http://localhost:3004',
        AGENT_STUDIO_INVOCATION_ID: undefined,
        AGENT_STUDIO_CALLBACK_TOKEN: undefined,
        AGENT_STUDIO_AGENT_KEY_SECRET: 'legacy-env-secret',
        AGENT_STUDIO_AGENT_KEY_FILE: undefined,
        AGENT_STUDIO_AGENT_KEY_FILES: JSON.stringify({
          antigravity: antigravityFile,
          'antig-opus': antigOpusFile,
        }),
      });
      const mod = await import(`../dist/tools/callback-tools.js?t=${Date.now()}`);
      const config = mod.getCallbackConfig();
      assert.equal(config, null, 'shared variant map must not fall back to a agent-ambiguous legacy secret');
    } finally {
      unlinkSync(antigravityFile);
      unlinkSync(antigOpusFile);
    }
  });
});
