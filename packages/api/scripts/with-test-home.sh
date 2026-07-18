#!/usr/bin/env bash
set -euo pipefail

real_home="${HOME:-}"
tmp_parent="${TMPDIR:-/tmp}"
tmp_parent="${tmp_parent%/}"
raw_test_home="$(mktemp -d "${tmp_parent}/agent-studio-test-home-XXXXXX")"
test_home="$(cd "$raw_test_home" && pwd -P)"

cleanup() {
  rm -rf "$raw_test_home"
}

trap cleanup EXIT

export HOME="$test_home"
export AGENT_STUDIO_TEST_SANDBOX="${AGENT_STUDIO_TEST_SANDBOX:-1}"
export AGENT_STUDIO_TEST_REAL_HOME="${AGENT_STUDIO_TEST_REAL_HOME:-$real_home}"
# Test entrypoints must not inherit a production NODE_ENV from the outer shell.
# Telemetry redaction tests rely on test-mode defaults instead of production secrets.
export NODE_ENV="test"

# Runtime-only envs leak from invocation env (set by the running agent-studio-runtime
# process when launching a agent). resolveBinaryRoot()/orchestrator code treats
# AGENT_STUDIO_RUNTIME_ROOT as the highest-priority binary root override, which makes
# capabilities/MCP-path tests assert against `agent-studio-runtime/...` instead of the
# stable main repo root. Strip them so test runs see the same environment whether
# launched from a runtime invocation or a clean shell.
unset AGENT_STUDIO_RUNTIME_ROOT
unset AGENT_STUDIO_MCP_SERVER_PATH
unset AGENT_STUDIO_WORKSPACE_ROOT

# DEFAULT_CAT_ID is user/runtime preference, not test fixture state. Leaving it
# inherited makes routing tests depend on which agent launched the test command.
unset DEFAULT_CAT_ID

exec "$@"
