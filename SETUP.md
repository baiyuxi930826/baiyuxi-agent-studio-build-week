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

```bash
pnpm dev
```

The terminal prints the local API and web addresses. If the default ports are occupied, set the documented local port variables in `.env`.

## Production-style build

```bash
pnpm build
```

Start the API and web workspaces in separate terminals:

```bash
pnpm start:api
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

Judges do not need to rebuild the project. Use the hosted demo and private credentials supplied in the Devpost testing instructions. The recommended path is documented in [README.md](README.md#judge-testing).
