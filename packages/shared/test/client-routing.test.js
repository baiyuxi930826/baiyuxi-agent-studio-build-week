import assert from 'node:assert/strict';
import test from 'node:test';
import { builtinAccountFamilyForClient, builtinAccountIdForClient, protocolForClient } from '../dist/index.js';

test('agentrunner shares anthropic builtin account family', () => {
  assert.equal(builtinAccountFamilyForClient('agentrunner'), 'anthropic');
  assert.equal(builtinAccountIdForClient('agentrunner'), 'claude');
});

test('protocolForClient normalizes provider family routing', () => {
  assert.equal(protocolForClient('agentrunner'), 'anthropic');
  assert.equal(protocolForClient('opencode'), 'anthropic');
  assert.equal(protocolForClient('dare'), 'openai');
  assert.equal(protocolForClient('antigravity'), null);
});
