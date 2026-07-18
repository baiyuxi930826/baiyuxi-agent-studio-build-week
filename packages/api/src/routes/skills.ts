/**
 * Skills Route — GET /api/skills
 * Agent Studio 共享 Skills 看板数据 + staleness (ADR-025 Phase 2)
 *
 * Write routes (sync, sync-skill) are in skills-write.ts.
 * Drift detection routes are in skills-drift.ts.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD_MOUNT_POINT_IDS } from '@agent-studio/shared';
import type { FastifyPluginAsync } from 'fastify';
import { readCapabilitiesConfig } from '../config/capabilities/capability-orchestrator.js';
import { readMountRules } from '../config/mount/mount-rules-store.js';
import { parseManifestSkillMeta, resolveSkillMcpStatuses, type SkillMcpDependency } from '../skills/skill-meta.js';
import { validateProjectPath } from '../utils/project-path.js';
import { resolveUserId } from '../utils/request-identity.js';
import {
  buildMountPointDirCandidates,
  buildSkillMountTargets,
  isSkillMountedAtPoint,
  resolveMainRepoPath,
} from '../utils/skill-mount.js';
import { checkStaleness, listSourceSkillNames, type SkillsStaleness } from '../utils/skill-source.js';

interface SkillMount {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
  kimi: boolean;
  [mountPointId: string]: boolean;
}

interface SkillMountHealth {
  enabledMountPoints: string[];
  mountedCount: number;
  requiredCount: number;
  allMounted: boolean;
}

interface SkillEntry {
  name: string;
  category: string;
  trigger: string;
  description?: string;
  source: 'agent-studio' | 'external';
  globalEnabled: boolean;
  mountPaths: string[];
  mounts: SkillMount;
  mountHealth: SkillMountHealth;
  requiresMcp?: SkillMcpDependency[];
}

interface MountIssue {
  skill: string;
  unmountedMountPoints: string[];
}

interface SkillsSummary {
  total: number;
  allMounted: boolean;
  registrationConsistent: boolean;
  registrationIssues: { unregistered: string[]; phantom: string[] };
  mountIssues: MountIssue[];
}

interface SkillsResponse {
  skills: SkillEntry[];
  summary: SkillsSummary;
  staleness: SkillsStaleness | null;
}

interface SkillsRouteOptions {
  mainProjectRoot?: string;
  skillsSourceDir?: string;
}

/** Resolve Agent Studio skills source from module location (stable across cwd/project). */
export function resolveSkillsSourceDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'agent-studio-skills', 'manifest.yaml');
    if (existsSync(candidate)) return join(dir, 'agent-studio-skills');
    dir = dirname(dir);
  }
  return resolve(process.cwd(), 'agent-studio-skills');
}

type AgentStudioSkillPolicyInfo = { source: 'agent-studio'; enabled: boolean; mountPaths?: string[] };

function resolveHomeDir(): string {
  return process.env.HOME || homedir();
}

async function loadDisabledAgentStudioSkillNames(projectRoot: string): Promise<Set<string>> {
  const config = await readCapabilitiesConfig(projectRoot);
  return new Set(
    config?.capabilities
      .filter(
        (cap) =>
          cap.type === 'skill' &&
          cap.source === 'agent-studio' &&
          !cap.pluginId &&
          (cap.globalEnabled ?? cap.enabled) === false,
      )
      .map((cap) => cap.id) ?? [],
  );
}

function collectAgentStudioSkillPolicy(
  config: Awaited<ReturnType<typeof readCapabilitiesConfig>>,
): Map<string, AgentStudioSkillPolicyInfo> {
  const lookup = new Map<string, AgentStudioSkillPolicyInfo>();
  for (const cap of config?.capabilities ?? []) {
    if (cap.type !== 'skill' || cap.source !== 'agent-studio' || cap.pluginId) continue;
    lookup.set(cap.id, {
      source: 'agent-studio',
      enabled: cap.globalEnabled ?? cap.enabled,
      mountPaths: cap.mountPaths,
    });
  }
  return lookup;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: GET /api/skills builds full skill inventory
export const skillsRoutes: FastifyPluginAsync<SkillsRouteOptions> = async (app, opts) => {
  const AGENT_STUDIO_SKILLS_SRC = opts.skillsSourceDir ?? resolveSkillsSourceDir();

  app.get('/api/skills', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required (session cookie or X-Agent-Studio-User header)' };
    }
    const skillsSrc = AGENT_STUDIO_SKILLS_SRC;
    const repoRoot = dirname(skillsSrc);
    const query = request.query as { projectPath?: string };
    let projectRoot = repoRoot;
    if (query.projectPath) {
      const validated = await validateProjectPath(query.projectPath);
      if (!validated) {
        reply.status(400);
        return { error: 'Invalid project path: must be an existing directory under allowed roots' };
      }
      projectRoot = validated;
    }
    const home = resolveHomeDir();
    const mainRepo = opts.mainProjectRoot ?? (await resolveMainRepoPath());
    const mountRules = await readMountRules(projectRoot, mainRepo);
    const enabledMountPoints = STANDARD_MOUNT_POINT_IDS.filter((id) => mountRules.mountPoints[id].enabled);
    const mountPointDirCandidates = buildMountPointDirCandidates(projectRoot, home, mountRules);
    const customMountTargets = buildSkillMountTargets(projectRoot, home, mountRules).filter(
      (target) => target.kind === 'custom',
    );
    const mainSkillsSrc = join(mainRepo, 'agent-studio-skills');

    const [sourceSkills, manifestMeta, disabledSkillNames, skillsCapConfig] = await Promise.all([
      listSourceSkillNames(skillsSrc),
      parseManifestSkillMeta(skillsSrc),
      loadDisabledAgentStudioSkillNames(projectRoot),
      readCapabilitiesConfig(projectRoot),
    ]);
    const mcpStatuses = await resolveSkillMcpStatuses(projectRoot, manifestMeta);

    // F228: project policy wins. Empty external project configs inherit the global
    // skill policy; projects with existing local rows keep their local facts until
    // capabilities GET/sync materializes explicit Agent Studio rows.
    const projectCapLookup = collectAgentStudioSkillPolicy(skillsCapConfig);
    // R12 P2: use Agent Studio skill entry count, not total capabilities count —
    // a project with only MCP entries and no skill rows should still inherit
    const shouldInheritGlobalSkillPolicy = projectRoot !== mainRepo && projectCapLookup.size === 0;
    const globalCapLookup = shouldInheritGlobalSkillPolicy
      ? collectAgentStudioSkillPolicy(await readCapabilitiesConfig(mainRepo))
      : new Map<string, AgentStudioSkillPolicyInfo>();

    // Build mount status lookup for each source skill
    const sourceSet = new Set(sourceSkills);
    const mountLookup = new Map<string, SkillEntry>();
    await Promise.all(
      sourceSkills.map(async (name) => {
        const [claude, codex, gemini, kimi] = await Promise.all([
          isSkillMountedAtPoint(mountPointDirCandidates.claude, skillsSrc, name, mainSkillsSrc),
          isSkillMountedAtPoint(mountPointDirCandidates.codex, skillsSrc, name, mainSkillsSrc),
          isSkillMountedAtPoint(mountPointDirCandidates.gemini, skillsSrc, name, mainSkillsSrc),
          isSkillMountedAtPoint(mountPointDirCandidates.kimi, skillsSrc, name, mainSkillsSrc),
        ]);
        const customMounts = await Promise.all(
          customMountTargets.map((target) => isSkillMountedAtPoint(target.candidates, skillsSrc, name, mainSkillsSrc)),
        );
        const mounts: SkillMount = { claude, codex, gemini, kimi };
        for (const [index, target] of customMountTargets.entries()) {
          mounts[target.id] = customMounts[index] ?? false;
        }
        const capInfo = projectCapLookup.get(name) ?? globalCapLookup.get(name);
        // When capInfo is inherited from global policy, ignore mountPaths.
        // Global mountPaths reflect the main project's mount state (often [] for
        // the source repo) and don't apply to the target project.  Only use
        // mountPaths from the project's own capability entries.
        const capInfoIsInherited = !projectCapLookup.has(name) && globalCapLookup.has(name);
        const declaredMountPaths =
          !capInfoIsInherited && Array.isArray(capInfo?.mountPaths) ? new Set(capInfo.mountPaths) : null;
        const skillDisabled =
          declaredMountPaths !== null
            ? declaredMountPaths.size === 0
            : capInfo?.enabled === false || disabledSkillNames.has(name);
        const requiredMountPoints = skillDisabled
          ? []
          : declaredMountPaths
            ? STANDARD_MOUNT_POINT_IDS.filter((id) => declaredMountPaths.has(id) && mountRules.mountPoints[id].enabled)
            : enabledMountPoints;
        const requiredCustomTargets = skillDisabled
          ? []
          : declaredMountPaths
            ? customMountTargets.filter((target) => declaredMountPaths.has(target.id))
            : customMountTargets;
        const requiredCustomTargetIds = new Set(requiredCustomTargets.map((target) => target.id));
        const mountedCount =
          requiredMountPoints.filter((id) => mounts[id]).length +
          customMountTargets.filter((target, index) => requiredCustomTargetIds.has(target.id) && customMounts[index])
            .length;
        const requiredCount = requiredMountPoints.length + requiredCustomTargets.length;
        const availableMountPointIds = [...enabledMountPoints, ...customMountTargets.map((target) => target.id)];
        const meta = manifestMeta.get(name);
        const trigger = meta?.triggers?.length ? meta.triggers.join('、') : '';
        const source = capInfo?.source ?? 'agent-studio';
        const globalEnabled =
          declaredMountPaths !== null ? declaredMountPaths.size > 0 : (capInfo?.enabled ?? !skillDisabled);
        const mountedPointIds = [
          ...enabledMountPoints.filter((id) => mounts[id]),
          ...customMountTargets.filter((target) => mounts[target.id]).map((target) => target.id),
        ];
        const mountPaths = capInfoIsInherited ? mountedPointIds : (capInfo?.mountPaths ?? mountedPointIds);
        mountLookup.set(name, {
          name,
          category: meta?.category ?? '未分类',
          trigger,
          source,
          globalEnabled,
          mountPaths,
          ...(meta?.description ? { description: meta.description } : {}),
          mounts,
          mountHealth: {
            enabledMountPoints: availableMountPointIds,
            mountedCount,
            requiredCount,
            allMounted: mountedCount === requiredCount,
          },
          ...(meta?.requiresMcp?.length
            ? { requiresMcp: meta.requiresMcp.map((id) => mcpStatuses.get(id) ?? { id, status: 'missing' }) }
            : {}),
        });
      }),
    );

    // Order: manifest.yaml key order first, then source-only skills not in manifest
    const ordered: string[] = [];
    const manifestOrdered = new Set<string>();
    for (const mName of manifestMeta.keys()) {
      if (sourceSet.has(mName)) {
        ordered.push(mName);
        manifestOrdered.add(mName);
      }
    }
    for (const name of sourceSkills) {
      if (!manifestOrdered.has(name)) ordered.push(name);
    }
    const skills = ordered.map((n) => mountLookup.get(n)!).filter(Boolean);

    // Registration consistency check
    const capConfig = await readCapabilitiesConfig(projectRoot);
    const sourceNames = new Set(sourceSkills);
    const capSkillNames = new Set(
      capConfig?.capabilities
        .filter((c) => c.type === 'skill' && c.source === 'agent-studio' && !c.pluginId)
        .map((c) => c.id) ?? [],
    );
    const unregistered = sourceSkills.filter((n) => !capSkillNames.has(n));
    const phantom = [...capSkillNames].filter((n) => !sourceNames.has(n));
    const registrationConsistent = unregistered.length === 0 && phantom.length === 0;
    const allMounted = skills.every((s) => s.mountHealth.allMounted);
    const mountIssues: MountIssue[] = skills
      .filter((s) => !s.mountHealth.allMounted)
      .map((s) => ({
        skill: s.name,
        unmountedMountPoints: s.mountHealth.enabledMountPoints.filter((id) => !s.mounts[id]),
      }));
    const staleness = await checkStaleness(projectRoot, skillsSrc, mainRepo);

    const response: SkillsResponse = {
      skills,
      summary: {
        total: skills.length,
        allMounted,
        registrationConsistent,
        registrationIssues: { unregistered, phantom },
        mountIssues,
      },
      staleness,
    };

    return response;
  });
};
