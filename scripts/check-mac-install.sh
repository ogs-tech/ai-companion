#!/usr/bin/env bash
# Runs before `npm run dev`: on macOS, offers to install the Dock shortcut
# (scripts/install-dev-shortcut.sh) if it isn't there yet. No-op elsewhere.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_NAME="AI Companion Dev.app"

if [[ -w "/Applications" ]]; then
  APP_BUNDLE="/Applications/${APP_NAME}"
else
  APP_BUNDLE="${HOME}/Applications/${APP_NAME}"
fi

CONFIG_PLIST="${APP_BUNDLE}/Contents/Resources/config.plist"

# Installed means: bundle exists AND its config still points at this checkout
# (a renamed/moved repo folder leaves a stale bundle that fails to launch).
is_installed() {
  [[ -d "${APP_BUNDLE}" ]] || return 1
  local configured_root
  configured_root="$(/usr/libexec/PlistBuddy -c "Print :rootDir" "${CONFIG_PLIST}" 2>/dev/null || true)"
  [[ "${configured_root}" == "${ROOT_DIR}" ]]
}

if is_installed; then
  exit 0
fi

if [[ ! -t 0 ]]; then
  echo "Atalho mac (${APP_BUNDLE}) ausente ou apontando para outra pasta. Rode 'npm run install:dev-shortcut' quando quiser instalar." >&2
  exit 0
fi

read -r -p "Atalho mac (Dock app) não está instalado ou aponta para outra pasta do projeto. Instalar agora? [y/N] " reply
case "${reply}" in
  [yY]|[yY][eE][sS])
    "${SCRIPT_DIR}/install-dev-shortcut.sh"
    ;;
  *)
    echo "Pulando instalação do atalho mac. Rode 'npm run install:dev-shortcut' quando quiser instalar." >&2
    ;;
esac
