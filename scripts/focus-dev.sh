#!/usr/bin/env bash
# Ask the running dev app to focus its window (no new Electron / Terminal).
# Exit 0 on success; exit 1 when dev is not running.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDERER_PORT=47173
FOCUS_PORT=47174
LOCK_FILE="${HOME}/.ai-companion/dev.lock"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-env.sh"

is_dev_running() {
  if [[ -f "${LOCK_FILE}" ]]; then
    local pid
    pid="$(tr -d '[:space:]' < "${LOCK_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
  fi
  lsof -iTCP:"${RENDERER_PORT}" -sTCP:LISTEN >/dev/null 2>&1
}

if ! is_dev_running; then
  exit 1
fi

if curl -sf --max-time 2 "http://127.0.0.1:${FOCUS_PORT}/focus" >/dev/null; then
  exit 0
fi

exit 1
