#!/usr/bin/env bash

# Shared download source override helpers for Bash install/start scripts.
# Explicit user input only; no automatic fallback policy here.

ARG_AGENT_STUDIO_NPM_REGISTRY="${ARG_AGENT_STUDIO_NPM_REGISTRY:-}"
ARG_AGENT_STUDIO_PIP_INDEX_URL="${ARG_AGENT_STUDIO_PIP_INDEX_URL:-}"
ARG_AGENT_STUDIO_PIP_EXTRA_INDEX_URL="${ARG_AGENT_STUDIO_PIP_EXTRA_INDEX_URL:-}"
ARG_AGENT_STUDIO_HF_ENDPOINT="${ARG_AGENT_STUDIO_HF_ENDPOINT:-}"

parse_manual_download_source_arg() {
  case "${1:-}" in
    --npm-registry=*)
      ARG_AGENT_STUDIO_NPM_REGISTRY="${1#*=}"
      return 0
      ;;
    --pip-index-url=*)
      ARG_AGENT_STUDIO_PIP_INDEX_URL="${1#*=}"
      return 0
      ;;
    --pip-extra-index-url=*)
      ARG_AGENT_STUDIO_PIP_EXTRA_INDEX_URL="${1#*=}"
      return 0
      ;;
    --hf-endpoint=*)
      ARG_AGENT_STUDIO_HF_ENDPOINT="${1#*=}"
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

apply_manual_download_source_overrides() {
  if [ -n "${ARG_AGENT_STUDIO_NPM_REGISTRY:-}" ]; then
    AGENT_STUDIO_NPM_REGISTRY="${ARG_AGENT_STUDIO_NPM_REGISTRY}"
  fi
  if [ -n "${ARG_AGENT_STUDIO_PIP_INDEX_URL:-}" ]; then
    AGENT_STUDIO_PIP_INDEX_URL="${ARG_AGENT_STUDIO_PIP_INDEX_URL}"
  fi
  if [ -n "${ARG_AGENT_STUDIO_PIP_EXTRA_INDEX_URL:-}" ]; then
    AGENT_STUDIO_PIP_EXTRA_INDEX_URL="${ARG_AGENT_STUDIO_PIP_EXTRA_INDEX_URL}"
  fi
  if [ -n "${ARG_AGENT_STUDIO_HF_ENDPOINT:-}" ]; then
    AGENT_STUDIO_HF_ENDPOINT="${ARG_AGENT_STUDIO_HF_ENDPOINT}"
  fi

  if [ -n "${AGENT_STUDIO_NPM_REGISTRY:-}" ]; then
    export AGENT_STUDIO_NPM_REGISTRY
    export NPM_CONFIG_REGISTRY="${AGENT_STUDIO_NPM_REGISTRY}"
  fi
  if [ -n "${AGENT_STUDIO_PIP_INDEX_URL:-}" ]; then
    export AGENT_STUDIO_PIP_INDEX_URL
    export PIP_INDEX_URL="${AGENT_STUDIO_PIP_INDEX_URL}"
  fi
  if [ -n "${AGENT_STUDIO_PIP_EXTRA_INDEX_URL:-}" ]; then
    export AGENT_STUDIO_PIP_EXTRA_INDEX_URL
    export PIP_EXTRA_INDEX_URL="${AGENT_STUDIO_PIP_EXTRA_INDEX_URL}"
  fi
  if [ -n "${AGENT_STUDIO_HF_ENDPOINT:-}" ]; then
    export AGENT_STUDIO_HF_ENDPOINT
    export HF_ENDPOINT="${AGENT_STUDIO_HF_ENDPOINT}"
  fi
}

print_manual_download_source_summary() {
  [ -n "${AGENT_STUDIO_NPM_REGISTRY:-}" ] && echo "  手动镜像: npm registry=$AGENT_STUDIO_NPM_REGISTRY"
  [ -n "${AGENT_STUDIO_PIP_INDEX_URL:-}" ] && echo "  手动镜像: pip index=$AGENT_STUDIO_PIP_INDEX_URL"
  [ -n "${AGENT_STUDIO_PIP_EXTRA_INDEX_URL:-}" ] && echo "  手动镜像: pip extra-index=$AGENT_STUDIO_PIP_EXTRA_INDEX_URL"
  [ -n "${AGENT_STUDIO_HF_ENDPOINT:-}" ] && echo "  手动镜像: hf endpoint=$AGENT_STUDIO_HF_ENDPOINT"
  true
}
