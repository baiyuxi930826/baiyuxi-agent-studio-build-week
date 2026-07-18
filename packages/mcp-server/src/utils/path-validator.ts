/**
 * Path Validator
 * 路径验证和目录管理工具
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findDeepestExistingPath, isWithinPath, resolveAbsolutePath, tryRealpathSync } from './path-utils.js';

/**
 * 配置接口
 */
export interface PathConfig {
  agentStudioDir: string;
  allowedDirs: string[];
}

/**
 * 默认的 Baiyuxi Agent Studio 子目录
 */
const AGENT_STUDIO_SUBDIRS = ['chat', 'memory', 'workspace', 'assets', '.state'] as const;

function parseAllowedWorkspaceDirs(value: string | undefined): string[] {
  if (!value) return [];
  const separatorPattern = path.delimiter === ';' ? /[;,]/ : /[:,]/;
  return value
    .split(separatorPattern)
    .map((dir) => dir.trim())
    .filter(Boolean);
}

/**
 * 获取默认配置
 * 从环境变量读取配置，若未设置则使用默认值
 */
export function getDefaultConfig(): PathConfig {
  const homeDir = os.homedir();
  const defaultAgentStudioDir = path.join(homeDir, '.agent-studio');

  const agentStudioDir = process.env['AGENT_STUDIO_DATA_DIR'] ?? defaultAgentStudioDir;

  // 解析允许的工作目录
  const allowedWorkspaceDirs = process.env['ALLOWED_WORKSPACE_DIRS'];
  const additionalDirs = parseAllowedWorkspaceDirs(allowedWorkspaceDirs);

  // 默认允许 agent-studio 目录和额外配置的目录
  const allowedDirs = [agentStudioDir, ...additionalDirs];

  return {
    agentStudioDir,
    allowedDirs,
  };
}

/**
 * 验证路径是否在允许的目录内
 * @param targetPath - 要验证的路径
 * @param config - 可选的配置，默认使用 getDefaultConfig()
 * @returns 是否允许访问该路径
 */
export function isPathAllowed(targetPath: string, config?: PathConfig): boolean {
  const { allowedDirs } = config ?? getDefaultConfig();

  // 解析为绝对路径
  const resolvedPath = resolveAbsolutePath(targetPath);

  const resolvedAllowedDirs = allowedDirs.map(resolveAbsolutePath);

  const realAllowedDirs = resolvedAllowedDirs.map((allowedDir) => tryRealpathSync(allowedDir) ?? allowedDir);

  // If target exists, validate its realpath; otherwise validate the realpath of the deepest
  // existing prefix to prevent symlink escapes like allowed/link -> /etc.
  if (fs.existsSync(resolvedPath)) {
    const realTarget = tryRealpathSync(resolvedPath);
    if (realTarget === null) {
      return false;
    }
    return realAllowedDirs.some((allowedDir) => isWithinPath(realTarget, allowedDir));
  }

  const existingPath = findDeepestExistingPath(resolvedPath);
  if (existingPath === null) {
    return false;
  }

  const realExisting = tryRealpathSync(existingPath);
  if (realExisting === null) {
    return false;
  }

  return realAllowedDirs.some((allowedDir) => isWithinPath(realExisting, allowedDir));
}

/**
 * 获取 Baiyuxi Agent Studio 数据目录
 * @param config - 可选的配置
 * @returns Baiyuxi Agent Studio 数据目录路径
 */
export function getAgentStudioDir(config?: PathConfig): string {
  const { agentStudioDir } = config ?? getDefaultConfig();
  return resolveAbsolutePath(agentStudioDir);
}

/**
 * 确保目录存在，若不存在则创建
 * @param dirPath - 目录路径
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 初始化 Baiyuxi Agent Studio 目录结构
 * 创建 ~/.agent-studio/ 及其子目录
 * @param config - 可选的配置
 */
export function initAgentStudioDir(config?: PathConfig): void {
  const agentStudioDir = getAgentStudioDir(config);

  // 创建主目录
  ensureDir(agentStudioDir);

  // 创建子目录
  for (const subdir of AGENT_STUDIO_SUBDIRS) {
    const subdirPath = path.join(agentStudioDir, subdir);
    ensureDir(subdirPath);
  }

  // 输出到 stderr（stdout 用于 JSON-RPC）
  console.error(`[agent-studio] Initialized directory: ${agentStudioDir}`);
}

/**
 * 获取安全的绝对路径
 * 解析路径并验证是否允许访问
 * @param targetPath - 目标路径
 * @param config - 可选的配置
 * @returns 解析后的绝对路径，若不允许则返回 null
 */
export function getSafePath(targetPath: string, config?: PathConfig): string | null {
  const resolvedPath = resolveAbsolutePath(targetPath);

  if (!isPathAllowed(resolvedPath, config)) {
    return null;
  }

  return resolvedPath;
}
