/**
 * Auto-populate agentRegistry for tests.
 *
 * Loads roles from agent-template.json directly (no catalog overlay) so the
 * registry is deterministic regardless of stale .agent-studio/agent-catalog.json
 * files that other tests may create during their run.
 *
 * Also redirects AGENT_TEMPLATE_PATH to an isolated temp copy so that
 * getCachedConfig() → loadAgentConfig() (used by getRoster(), getReviewPolicy(),
 * etc.) never picks up catalog artifacts from other test files.
 *
 * Usage: import './helpers/setup-agent-registry.js';
 *
 * See also: packages/api/package.json `--import $(pwd)/...` for Node loader usage.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentRegistry } from '@agent-studio/shared';
import { createIsolatedTemplateRoot } from './isolated-template-root.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, '../../../../agent-template.json');

// Redirect AGENT_TEMPLATE_PATH to a UNIQUE, collision-free temp root (mkdtemp) with no
// .agent-studio/ overlay, so loadAgentConfig() (called by getCachedConfig → getRoster, etc.)
// never inherits a stale roles:[] agent-catalog.json that a pid-reused prior process left
// behind (its app boot wrote one via bootstrapDefaultAgentCatalog). The previous
// `agent-studio-test-template-${process.pid}` name was not unique across time → pid reuse
// leaked an empty roster into unrelated tests. See isolated-template-root.js for the
// full F211 #2013 follow-up rationale.
const { templatePath, cleanup } = createIsolatedTemplateRoot(process.env.TMPDIR ?? '/tmp', TEMPLATE_PATH);
process.on('exit', cleanup);
process.env.AGENT_TEMPLATE_PATH = templatePath;

async function registerAllAgents() {
  const { loadAgentConfig, toAllAgentConfigs } = await import('../../dist/config/agent-config-loader.js');
  // Pass explicit path → reads ONLY agent-template.json, skips catalog overlay.
  const allConfigs = toAllAgentConfigs(loadAgentConfig(TEMPLATE_PATH));
  for (const [id, config] of Object.entries(allConfigs)) {
    if (!agentRegistry.has(id)) {
      agentRegistry.register(id, config);
    }
  }
}

await registerAllAgents();
