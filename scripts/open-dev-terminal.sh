#!/usr/bin/env bash
# Open a single Terminal window streaming dev logs (dev keeps running if Terminal closes).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${HOME}/.ai-companion"
LOG_FILE="${LOG_DIR}/dev.log"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-env.sh"

escape_applescript() {
  printf '%s' "$1" | sed "s/'/''/g"
}

mkdir -p "${LOG_DIR}"
: >> "${LOG_FILE}"

if ! [[ -x "${SCRIPT_DIR}/focus-dev.sh" ]] || ! "${SCRIPT_DIR}/focus-dev.sh"; then
  if [[ -x "${SCRIPT_DIR}/dev-app-background.sh" ]]; then
    "${SCRIPT_DIR}/dev-app-background.sh"
  fi
  for _ in $(seq 1 45); do
    if "${SCRIPT_DIR}/focus-dev.sh"; then
      break
    fi
    sleep 1
  done
fi

CMD="cd '$(escape_applescript "${ROOT_DIR}")' && tail -n 80 -f '$(escape_applescript "${LOG_FILE}")'"

# do script first, then activate — avoids an extra blank Terminal window.
osascript <<APPLESCRIPT
tell application "Terminal"
  do script "${CMD}"
  activate
end tell
APPLESCRIPT
