# MCP Callbacks HTTP API Reference

> 降级自 `using-mcp-callbacks` skill。按需查阅。

## 主路径

智能体默认使用 `agent_studio_*` MCP 工具，不手写 Agent Studio 第一方 callback HTTP。

HTTP callback route 是 MCP tool 的底层实现和维护者调试面，不是 skill 主路径。只有在工具目录缺失、agent-key / invocation credentials 故障诊断、或维护 callback server 本身时，才查 route 名称；这种场景需要在 PR / handoff 里说明为什么不能走 MCP。

## Tool Mapping

| 需求 | MCP tool | 底层 route（维护者参考） |
|------|----------|--------------------------|
| 发当前 thread 中途消息 | `agent_studio_post_message` | `POST /api/callbacks/post-message` |
| 跨 thread 通知 | `agent_studio_cross_post_message` | `POST /api/callbacks/post-message` with target thread fields |
| 读 thread 上下文 | `agent_studio_get_thread_context` | `GET /api/callbacks/thread-context` |
| 查当前 thread 智能体列表 | `agent_studio_get_thread_agents` | `GET /api/callbacks/thread-agents` |
| 找 thread | `agent_studio_list_threads` | `GET /api/callbacks/list-threads` |
| 查 feature index | `agent_studio_feat_index` | `GET /api/callbacks/feat-index` |
| 查 pending mentions | `agent_studio_get_pending_mentions` | `GET /api/callbacks/pending-mentions` |
| 查 GitHub 仓库权限 | `agent_studio_get_github_permission` | `GET /api/callbacks/github-permission?repoFullName=owner/repo` |
| ack mentions | `agent_studio_ack_mentions` | `POST /api/callbacks/ack-mentions` |
| 建毛线球任务 | `agent_studio_create_task` | `POST /api/callbacks/create-task` |
| 更新任务状态 | `agent_studio_update_task` | `POST /api/callbacks/update-task` |
| 列任务 | `agent_studio_list_tasks` | `GET /api/callbacks/list-tasks` |
| 注册 PR tracking | `agent_studio_register_pr_tracking` | `POST /api/callbacks/register-pr-tracking` |
| 搜证据 | `agent_studio_search_evidence` | `GET /api/callbacks/search-evidence` |
| 写长期记忆 | `agent_studio_retain_memory_callback` | `POST /api/callbacks/retain-memory` |
| 请求权限 | `agent_studio_request_permission` | `POST /api/callbacks/request-permission` |
| 查权限请求状态 | `agent_studio_check_permission_status` | `GET /api/callbacks/permission-status` |
| 创建 rich block | `agent_studio_create_rich_block` | `POST /api/callbacks/create-rich-block` |
| 提交游戏行动 | `agent_studio_submit_game_action` | `POST /api/callbacks/submit-game-action` |
| 更新 workflow 告示牌 | `agent_studio_update_workflow` | `POST /api/callbacks/update-workflow-sop` |
| 开多智能体 vote | `agent_studio_start_vote` | `POST /api/callbacks/start-vote` |

## Credentials

MCP 工具会从 invocation credentials 或 agent-key sidecar 自动处理认证。不要把 `$AGENT_STUDIO_INVOCATION_ID` / `$AGENT_STUDIO_CALLBACK_TOKEN` 拼进 skill 示例里。

常见失败：

| 现象 | 处理 |
|------|------|
| invocation callback 401 | 当前 callback token 过期；用本轮可用 MCP 工具重试，或在最终回复里用行首 `@` 路由 |
| shared Antigravity MCP 缺凭证 | 传 `agentKeyAgentId`，让工具选择对应智能体的 sidecar key |
| 工具目录完全没有对应能力 | 按 F223 追踪 execution surface 缺口，不把 HTTP route 当主路径 |

## Notes

- 正常回复直接输出文本；只有中途进度、跨 thread 通知、任务状态等需要 callback MCP。
- Rich block 主路径是 `agent_studio_create_rich_block`；字段仍是 `kind` / `v` / `id`。
- 维护 callback server 时请读 `packages/mcp-server/src/tools/callback-tools.ts` 和 `packages/api/src/routes/callbacks.ts`，不要从 skill 文档复制 HTTP 示例。
