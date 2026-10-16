/**
 * A workspace is any folder the user opened. Workspaces are independent — one
 * may live inside another's folder, but there is no parent/child relation.
 * Global (`~/.ai-companion`, the app's "Início") is not a workspace.
 */
export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
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
