import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('agent_studio_get_github_permission MCP tool', () => {
  let originalEnv;
  let originalFetch;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.AGENT_STUDIO_API_URL = 'http://127.0.0.1:3003';
    process.env.AGENT_STUDIO_INVOCATION_ID = 'test-invocation';
    process.env.AGENT_STUDIO_CALLBACK_TOKEN = 'test-token';
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    globalThis.fetch = originalFetch;
  });

  test('queries github-permission with repoFullName and header-only auth', async () => {
    const { handleGetGitHubPermission } = await import('../dist/tools/callback-tools.js');

    let capturedUrl;
    let capturedOptions;
    globalThis.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return {
        ok: true,
        json: async () => ({
          status: 'ok',
          repoFullName: 'owner/repo',
          accessible: true,
          viewerPermission: 'ADMIN',
          login: 'octocat',
          source: 'test',
        }),
      };
    };

    const result = await handleGetGitHubPermission({ repoFullName: 'owner/repo' });

    assert.equal(result.isError, undefined);
    assert.ok(capturedUrl.includes('/api/callbacks/github-permission'));
    assert.ok(capturedUrl.includes('repoFullName=owner%2Frepo'));
    assert.ok(!capturedUrl.includes('invocationId='), 'creds must not be written to query');
    assert.ok(!capturedUrl.includes('callbackToken='), 'creds must not be written to query');
    assert.equal(capturedOptions.headers['x-invocation-id'], 'test-invocation');
    assert.equal(capturedOptions.headers['x-callback-token'], 'test-token');

    const body = JSON.parse(result.content[0].text);
    assert.equal(body.viewerPermission, 'ADMIN');
    assert.equal(body.login, 'octocat');
  });

  test('tool is registered in callbackTools with schema + handler', async () => {
    const { callbackTools } = await import('../dist/tools/callback-tools.js');
    const tool = callbackTools.find((entry) => entry.name === 'agent_studio_get_github_permission');

    assert.ok(tool, 'agent_studio_get_github_permission must be registered in callbackTools');
    assert.ok(tool.inputSchema, 'tool must expose an inputSchema');
    assert.equal(typeof tool.handler, 'function', 'tool must wire a handler');
    assert.ok('repoFullName' in tool.inputSchema, 'tool schema must require repoFullName');
  });
});
