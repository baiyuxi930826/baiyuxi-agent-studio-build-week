#!/usr/bin/env node

/**
 * Baiyuxi Agent Studio MCP Server — Collab Surface
 * 只暴露协作核心工具（消息、上下文、任务、权限）。
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { installShutdownHandlers, startRefreshLoop } from './refresh-loop.js';
import { registerCollabToolset } from './server-toolsets.js';
import { initAgentStudioDir } from './utils/path-validator.js';

function createBaseServer(name: string): McpServer {
  return new McpServer({
    name,
    version: '0.1.0',
  });
}

/**
 * Create a Collab MCP server instance with messaging, context,
 * task management, and permission tools registered.
 */
export function createCollabServer(): McpServer {
  const server = createBaseServer('agent-studio-collab-mcp');
  registerCollabToolset(server);
  return server;
}

async function main(): Promise<void> {
  initAgentStudioDir();
  const server = createCollabServer();
  const transport = new StdioServerTransport();
  console.error('[agent-studio-collab] MCP Server starting...');
  await server.connect(transport);
  console.error('[agent-studio-collab] MCP Server running on stdio');

  const refreshLoop = startRefreshLoop();
  installShutdownHandlers(refreshLoop);
}

const isEntryPoint = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isEntryPoint) {
  main().catch((err) => {
    console.error('[agent-studio-collab] Fatal error:', err);
    process.exit(1);
  });
}
