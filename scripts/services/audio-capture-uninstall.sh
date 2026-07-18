#!/usr/bin/env bash
# scripts/services/audio-capture-uninstall.sh
# Remove F195 audio-capture virtual environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${AGENT_STUDIO_HOME:=$(cd "$SCRIPT_DIR/../.." && pwd)/.agent-studio}"
# Expand leading ~ (codex P2 3264135134).
case "$AGENT_STUDIO_HOME" in
  "~") AGENT_STUDIO_HOME="$HOME" ;;
  "~/"*) AGENT_STUDIO_HOME="${HOME}/${AGENT_STUDIO_HOME#~/}" ;;
esac
export AGENT_STUDIO_HOME

VENV_DIR="${AGENT_STUDIO_HOME}/audio-capture-venv"
VENV_DIR_LEGACY="${HOME}/.agent-studio/audio-capture-venv"

removed=0
if [ -d "$VENV_DIR" ]; then
  echo "Removing venv: $VENV_DIR ..."
  rm -rf "$VENV_DIR"
  removed=1
fi
if [ -d "$VENV_DIR_LEGACY" ] && [ "$VENV_DIR_LEGACY" != "$VENV_DIR" ]; then
  echo "Removing legacy venv: $VENV_DIR_LEGACY ..."
  rm -rf "$VENV_DIR_LEGACY"
  removed=1
fi
if [ "$removed" = "0" ]; then
  echo "Venv not found: $VENV_DIR (legacy: $VENV_DIR_LEGACY)"
  exit 0
fi
echo "Uninstall complete."
