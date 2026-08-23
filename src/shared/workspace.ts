export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  isDefault: boolean;
  createdAt: string;
}

export interface WorkspaceRegistryFile {
  workspaces: Workspace[];
  activeWorkspaceId: string;
}
