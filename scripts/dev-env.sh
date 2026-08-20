#!/usr/bin/env bash
# Shell env for Dock/Finder launches (no .zshrc / .zprofile loaded).

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "${NVM_DIR}/nvm.sh"
fi

if [[ -s "${HOME}/.fnm/env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.fnm/env"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js or load nvm/fnm in your shell, then retry." >&2
  exit 127
fi
