# Baiyuxi Agent Studio — OpenAI Build Week Edition

An evidence-driven multi-agent engineering workspace where Codex and GPT-5.6 help plan, build, review, test, and prove software changes.

> OpenAI Build Week 2026 · Developer Tools track

## Build Week disclosure

Agent Studio existed before the OpenAI Build Week submission period. Judges should evaluate only the additions documented in [BUILD_WEEK.md](BUILD_WEEK.md).

During the submission period, Codex with GPT-5.6 was used for repository mapping, change-scope review, implementation verification, security auditing, release evidence, and submission preparation. A sanitized evidence summary is included without credentials or raw private transcripts.

## What it does

Baiyuxi Agent Studio is a coordination layer above agent CLIs such as Codex. It combines:

- persistent multi-agent threads and runtime identities;
- configurable provider adapters, skills, and MCP tools;
- shared memory, invocation records, and review evidence;
- explicit human-controlled delivery gates;
- an editable thread-title candidate flow that never silently renames a conversation.

The default title strategy is deterministic and local. It reads visible thread content, proposes a candidate, and stores the title only after confirmation.

## Build Week work

The eligible event-period work includes:

1. Completing the public runtime identity migration across the API, UI, MCP layer, configuration, and tests.
2. Restoring the repository-wide public quality gate after that migration.
3. Adding the explicit, editable thread-title candidate workflow with ownership, stale-response, pagination, and IME safeguards.
4. Producing a clean public distribution with credential scanning and source provenance.

See [BUILD_WEEK.md](BUILD_WEEK.md) and the [sanitized Codex session summary](docs/build-week-evidence/codex-session-summary.md) for evidence.

## Origin and licensing

This project is an independent derivative of [Clowder AI](https://github.com/zts212653/clowder-ai). The upstream MIT copyright notice is preserved in [LICENSE](LICENSE), and detailed provenance is recorded in [NOTICE](NOTICE).

Clowder AI trademarks, cat logos, character assets, historical screenshots, and private operational material are not included. No upstream endorsement or affiliation is implied.

## Architecture

The repository is a TypeScript monorepo:

- `packages/web`: Next.js and React workspace UI
- `packages/api`: Fastify API and agent runtime
- `packages/shared`: shared runtime contracts
- `packages/mcp-server`: Model Context Protocol server
- `packages/finance`: reusable usage and cost utilities

Redis is optional for persistent runtime state; SQLite-backed evidence stores support local operation. Socket.IO carries live collaboration updates.

## Quick start

Requirements: Node.js 20+, pnpm 9+, Git. Redis is optional.

```bash
git clone https://github.com/baiyuxi930826/baiyuxi-agent-studio-build-week.git
cd baiyuxi-agent-studio-build-week
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

On Windows PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env
```

The root workspace commands do not automatically import the copied `.env` file. For a credential-free local review, start the built application in two terminals with explicit memory mode:

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

Then open <http://localhost:3003>. Provider credentials are optional for inspecting the workspace. To invoke an external model, configure your own provider account through the application settings or local environment.

Full build and verification instructions are in [SETUP.md](SETUP.md).

## Judge testing

- Hosted demo: <https://jd.luccc.uk/login>
- The hosted workspace is an owner-only production instance; production credentials are not shared
- Repository: this public Build Week edition contains no production credentials or private session data

Recommended test flow:

1. Follow the local memory-mode commands above and open <http://localhost:3003>.
2. Inspect the agent catalog, routing surfaces, and invocation evidence model.
3. Create or open a thread and request a title candidate.
4. Edit or confirm the candidate and verify that no title changes before confirmation.
5. Use your own authenticated Codex CLI only if you want to exercise a live model invocation.

## Verification

```bash
pnpm build
pnpm check
pnpm test
```

The default test command runs the deterministic Build Week regression set (204 tests in the publication snapshot).

## How Codex accelerated the work

Codex running GPT-5.6 helped map a large pre-existing monorepo, isolate the eligible event-period delta, trace runtime identity changes across package boundaries, review the title workflow's trust boundaries, run and interpret regression checks, audit the full private history for credentials, and package this public edition.

Human decisions remained explicit: selecting the competition scope, preserving upstream attribution, excluding trademarked and private assets, deciding the confirmation-first title interaction, reviewing test evidence, and authorizing publication.

## Security

Please use [GitHub private vulnerability reporting](https://github.com/baiyuxi930826/baiyuxi-agent-studio-build-week/security/advisories/new). Do not post credentials, private prompts, or production configuration in a public issue.
