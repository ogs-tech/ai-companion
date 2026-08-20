#!/usr/bin/env bash
set -euo pipefail

# Launch electron-vite dev with cwd = repo root (required for project-scoped paths).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-env.sh"

cd "${ROOT_DIR}"
exec npm run dev
