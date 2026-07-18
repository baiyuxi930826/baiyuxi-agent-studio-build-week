/**
 * F166: Agent display order persistence.
 * Stores user's custom agent ordering in .agent-studio/user-preferences.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UserPreferences } from '@agent-studio/shared';

function preferencesPath(projectRoot: string): string {
  return resolve(projectRoot, '.agent-studio', 'user-preferences.json');
}

function readPreferences(projectRoot: string): UserPreferences {
  const path = preferencesPath(projectRoot);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as UserPreferences) : {};
  } catch {
    return {};
  }
}

function writePreferences(projectRoot: string, prefs: UserPreferences): void {
  mkdirSync(resolve(projectRoot, '.agent-studio'), { recursive: true });
  writeFileSync(preferencesPath(projectRoot), `${JSON.stringify(prefs, null, 2)}\n`, 'utf-8');
}

export function loadAgentOrder(projectRoot: string): string[] {
  const prefs = readPreferences(projectRoot);
  if (!Array.isArray(prefs.agentOrder)) return [];
  return prefs.agentOrder.filter((id): id is string => typeof id === 'string');
}

export function saveAgentOrder(projectRoot: string, agentIds: string[]): void {
  const prefs = readPreferences(projectRoot);
  writePreferences(projectRoot, { ...prefs, agentOrder: agentIds });
}
