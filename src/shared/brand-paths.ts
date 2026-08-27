import { brand } from './brand.js';

export function workspacePath(home: string): string {
  return `${home}/${brand.workspaceDirName}`;
}

export function legacyWorkspacePath(home: string): string {
  return `${home}/${brand.legacy.workspaceDirName}`;
}

export function projectWorkspacePath(cwd: string): string {
  return `${cwd}/${brand.workspaceDirName}`;
}

export function devLockPath(home: string): string {
  return `${workspacePath(home)}/dev.lock`;
}

export function cursorPluginPath(home: string): string {
  return `${home}/.cursor/plugins/${brand.cursorPluginId}`;
}

export function legacyCursorPluginPath(home: string): string {
  return `${home}/.cursor/plugins/${brand.legacy.cursorPluginId}`;
}

const INDEX_MARKER_FILE = 'index.md';

/** Canonical `<dataDir>/index.md`, written once per workspace by WorkspaceBootstrapService. */
export function workspaceIndexMarkerPath(dataDir: string): string {
  return `${dataDir}/${INDEX_MARKER_FILE}`;
}

/** `<projectPath>/.ai-companion/index.md` — a symlink back to workspaceIndexMarkerPath. */
export function projectIndexMarkerPath(projectPath: string): string {
  return `${projectPath}/${brand.workspaceDirName}/${INDEX_MARKER_FILE}`;
}
