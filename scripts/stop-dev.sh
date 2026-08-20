#!/usr/bin/env bash
# Stop background dev (npm/electron-vite/Electron). Called when quitting AI Companion Dev from the Dock.
set -euo pipefail

LOG_DIR="${HOME}/.ai-companion"
SHELL_PID_FILE="${LOG_DIR}/dev-shell.pid"
PGID_FILE="${LOG_DIR}/dev.pgid"
LOCK_FILE="${LOG_DIR}/dev.lock"
RENDERER_PORT=47173
FOCUS_PORT=47174

kill_pid_gracefully() {
  local pid="$1"
  if [[ -z "${pid}" ]] || ! kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi
  kill -TERM "${pid}" 2>/dev/null || true
}

kill_pgid_gracefully() {
  local pgid="$1"
  if [[ -z "${pgid}" ]]; then
    return 0
  fi
  kill -TERM -- "-${pgid}" 2>/dev/null || true
}

if [[ -f "${PGID_FILE}" ]]; then
  pgid="$(tr -d '[:space:]' < "${PGID_FILE}" 2>/dev/null || true)"
  kill_pgid_gracefully "${pgid}"
fi

if [[ -f "${SHELL_PID_FILE}" ]]; then
  shell_pid="$(tr -d '[:space:]' < "${SHELL_PID_FILE}" 2>/dev/null || true)"
  kill_pid_gracefully "${shell_pid}"
  if [[ -n "${shell_pid}" ]]; then
    pkill -TERM -P "${shell_pid}" 2>/dev/null || true
  fi
fi

if [[ -f "${LOCK_FILE}" ]]; then
  electron_pid="$(tr -d '[:space:]' < "${LOCK_FILE}" 2>/dev/null || true)"
  kill_pid_gracefully "${electron_pid}"
fi

sleep 0.5

for port in "${RENDERER_PORT}" "${FOCUS_PORT}"; do
  while read -r pid; do
    [[ -n "${pid}" ]] && kill -KILL "${pid}" 2>/dev/null || true
  done < <(lsof -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)
done

rm -f "${SHELL_PID_FILE}" "${PGID_FILE}" "${LOCK_FILE}"
