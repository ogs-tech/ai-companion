#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_NAME="AI Companion Dev.app"

if [[ -w "/Applications" ]]; then
  APP_BUNDLE="/Applications/${APP_NAME}"
else
  APP_BUNDLE="${HOME}/Applications/${APP_NAME}"
fi

LAUNCHER="${APP_BUNDLE}/Contents/MacOS/launcher"
RESOURCES="${APP_BUNDLE}/Contents/Resources"
LEGACY_HOME="${HOME}/Applications/${APP_NAME}"
LEGACY_COMMAND="${HOME}/Applications/Superset AI Dev.command"
LEGACY_APP="${HOME}/Applications/Superset AI Dev.app"

cd "${ROOT_DIR}"

chmod +x "${SCRIPT_DIR}/dev-app-background.sh" "${SCRIPT_DIR}/open-dev-terminal.sh" "${SCRIPT_DIR}/stop-dev.sh"

echo "→ Linking global CLI (superset-ai-dev)…"
npm link

echo "→ Installing Dock app (${APP_BUNDLE})…"
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS" "${RESOURCES}"

cat > "${APP_BUNDLE}/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIdentifier</key>
  <string>com.ogs-tech.ai-companion-dev</string>
  <key>CFBundleName</key>
  <string>AI Companion Dev</string>
  <key>CFBundleDisplayName</key>
  <string>AI Companion Dev</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSMultipleInstancesProhibited</key>
  <true/>
  <key>NSSupportsAutomaticTermination</key>
  <false/>
</dict>
</plist>
EOF

cat > "${RESOURCES}/config.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>rootDir</key>
  <string>${ROOT_DIR}</string>
</dict>
</plist>
EOF

if ! command -v clang >/dev/null 2>&1; then
  echo "clang not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

echo "→ Compiling Dock launcher…"
clang "${SCRIPT_DIR}/dock-launcher.m" -framework Cocoa -O2 -o "${LAUNCHER}"
chmod +x "${LAUNCHER}"

# Drop stale copies from earlier installs.
if [[ "${LEGACY_HOME}" != "${APP_BUNDLE}" ]]; then
  rm -rf "${LEGACY_HOME}"
fi
rm -f "${LEGACY_COMMAND}"

echo ""
echo "Atalho dev instalado:"
echo "  Terminal: superset-ai-dev   (de qualquer pasta)"
echo "  Finder:   ${APP_BUNDLE}"
echo "  Dock:     arraste o app de Aplicativos para o Dock"
echo "  Dock (botão direito): Open Terminal (logs) | Quit AI Companion Dev (para o projeto)"
echo ""
open -R "${APP_BUNDLE}"
