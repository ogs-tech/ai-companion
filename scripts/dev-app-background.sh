#!/usr/bin/env bash
# Start electron-vite dev detached from Terminal. Logs → ~/.ai-companion/dev.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${HOME}/.ai-companion"
LOG_FILE="${LOG_DIR}/dev.log"
SHELL_PID_FILE="${LOG_DIR}/dev-shell.pid"
PGID_FILE="${LOG_DIR}/dev.pgid"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-env.sh"

if [[ -x "${SCRIPT_DIR}/focus-dev.sh" ]] && "${SCRIPT_DIR}/focus-dev.sh"; then
  exit 0
fi

if [[ -f "${SHELL_PID_FILE}" ]]; then
  existing_pid="$(tr -d '[:space:]' < "${SHELL_PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
    exit 0
  fi
fi

mkdir -p "${LOG_DIR}"
: >> "${LOG_FILE}"

cd "${ROOT_DIR}"

# setsid → new session/process group so closing Terminal never sends SIGHUP to dev.
if command -v setsid >/dev/null 2>&1; then
  setsid bash -c "cd '${ROOT_DIR}' && exec npm run dev >> '${LOG_FILE}' 2>&1" &
else
  nohup bash -c "cd '${ROOT_DIR}' && exec npm run dev >> '${LOG_FILE}' 2>&1" &
fi

dev_pid=$!
echo "${dev_pid}" > "${SHELL_PID_FILE}"
echo "${dev_pid}" > "${PGID_FILE}"
disown 2>/dev/null || true
