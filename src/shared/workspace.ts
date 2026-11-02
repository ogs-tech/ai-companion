/**
 * A workspace holds 1..N folders. `rootPath` is the first (primary) folder and
 * is what single-folder workspaces have always stored; `extraFolders` are the
 * ones added later. A folder belongs to at most one workspace. Workspaces are
 * independent — one may live inside another's folder, but there is no
 * parent/child relation. Global (`~/.ai-companion`, the app's "Início") is not
 * a workspace.
 */
export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  /** Folders added after the first, in order. Absent on single-folder workspaces. */
  extraFolders?: string[];
  createdAt: string;
  /** ISO timestamp of the last `switchTo`/`open`. Absent until first opened (and on pre-cycle-2 data) — sorts last. */
  lastOpenedAt?: string;
}

export const WORKSPACE_REGISTRY_SCHEMA_VERSION = 2;

export interface WorkspaceRegistryFile {
  schemaVersion: typeof WORKSPACE_REGISTRY_SCHEMA_VERSION;
  workspaces: Workspace[];
  /** `null` = Global (Início) — no workspace is open. */
  activeWorkspaceId: string | null;
}

/** Every folder of a workspace, primary first. */
export function workspaceFolders(workspace: Pick<Workspace, 'rootPath' | 'extraFolders'>): string[] {
  return [workspace.rootPath, ...(workspace.extraFolders ?? [])];
}

const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

/**
 * The name each folder goes by inside a multi-folder workspace — its basename,
 * made unique (`app`, `app-2`) in folder order. It is the first segment of the
 * workspace-relative paths the file tree, editor tabs and git decorations use.
 */
export function folderAliases(workspace: Pick<Workspace, 'rootPath' | 'extraFolders'>): Record<string, string> {
  const used = new Set<string>();
  const aliases: Record<string, string> = {};
  for (const folder of workspaceFolders(workspace)) {
    const base = baseName(folder);
    let alias = base;
    for (let n = 2; used.has(alias); n++) alias = `${base}-${n}`;
    used.add(alias);
    aliases[folder] = alias;
  }
  return aliases;
}
