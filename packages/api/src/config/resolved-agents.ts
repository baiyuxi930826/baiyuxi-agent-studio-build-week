import { agentRegistry } from '@agent-studio/shared';
import { bootstrapAgentCatalog, resolveAgentCatalogPath } from './agent-catalog-store.js';
import { loadAgentConfig, toAllAgentConfigs } from './agent-config-loader.js';
import { resolveProjectTemplatePath } from './project-template-path.js';

export function getProjectResolvedAgents(projectRoot: string) {
  try {
    const templatePath = resolveProjectTemplatePath(projectRoot);
    bootstrapAgentCatalog(projectRoot, templatePath);
    return toAllAgentConfigs(loadAgentConfig(resolveAgentCatalogPath(projectRoot)));
  } catch {
    return {};
  }
}

export function getResolvedAgents(projectRoot: string) {
  try {
    const resolved = getProjectResolvedAgents(projectRoot);
    for (const [id, config] of Object.entries(agentRegistry.getAllConfigs())) {
      if (!resolved[id]) resolved[id] = config;
    }
    return resolved;
  } catch {
    return agentRegistry.getAllConfigs();
  }
}
