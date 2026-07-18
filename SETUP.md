# Setup

## Supported platforms

- Windows 11 with PowerShell
- macOS 13 or later
- Ubuntu 22.04 or later

The Build Week repository contains the web, API, MCP, shared, and finance workspaces. The separate desktop packaging layer is intentionally excluded from this public edition because it has a different license scope and used upstream brand assets.

## Requirements

- Node.js 20 or later
- pnpm 9.x (`corepack enable` is recommended)
- Git
- Optional: Redis for persistent shared state
- Optional: Codex CLI for live Codex invocations

## Install

```bash
git clone https://github.com/baiyuxi930826/baiyuxi-agent-studio-build-week.git
cd baiyuxi-agent-studio-build-week
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

PowerShell equivalent:

```powershell
git clone https://github.com/baiyuxi930826/baiyuxi-agent-studio-build-week.git
Set-Location baiyuxi-agent-studio-build-week
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

All values in `.env.example` are placeholders or local defaults. Add only credentials you own, and never commit `.env`.

## Development

The root workspace commands do not automatically import `.env`. Export the required values in the shell that launches the process. For a credential-free review, memory mode is the smallest reproducible path.

```bash
MEMORY_STORE=1 API_SERVER_PORT=3004 pnpm --filter @agent-studio/api dev
```

In a second terminal:

```bash
PORT=3003 pnpm --filter @agent-studio/web dev
```

PowerShell equivalent:

```powershell
$env:MEMORY_STORE = '1'
$env:API_SERVER_PORT = '3004'
pnpm --filter @agent-studio/api dev
```

In a second PowerShell terminal:

```powershell
$env:PORT = '3003'
pnpm --filter @agent-studio/web dev
```

Open <http://localhost:3003>. If the default ports are occupied, keep the API and web values aligned with the web rewrite configuration.

## Production-style build

```bash
pnpm build
```

Start the API and web workspaces in separate terminals. The explicit `MEMORY_STORE=1` opt-in is required when Redis is not running:

```bash
# Terminal 1
MEMORY_STORE=1 API_SERVER_PORT=3004 pnpm start:api

# Terminal 2
PORT=3003 pnpm start:web
```

PowerShell equivalent:

```powershell
# Terminal 1
$env:MEMORY_STORE = '1'
$env:API_SERVER_PORT = '3004'
pnpm start:api

# Terminal 2
$env:PORT = '3003'
pnpm start:web
```

## Codex integration

Install and authenticate the OpenAI Codex CLI using your own account. Agent Studio launches Codex as an external CLI adapter and records structured invocation events. No Codex credentials are stored in this repository.

## Checks

```bash
pnpm check
pnpm test
```

The default test command runs the deterministic Build Week regression set used by CI.

## Judge shortcut

The hosted workspace is an owner-only production instance, so production credentials are not shared. Judges can use the public video and repository, then run the credential-free memory-mode path above for hands-on review. The recommended flow is documented in [README.md](README.md#judge-testing).
