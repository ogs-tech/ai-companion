import { folderAliases, workspaceFolders, type Workspace } from '../../shared/workspace.js';
import { useActiveWorkspace } from './use-workspaces.js';

export interface FolderRouting {
  /** More than one folder: workspace-relative paths start with the folder's alias. */
  multi: boolean;
  /** Absolute folders in workspace order. */
  folders: string[];
  /** folder → alias (the first segment of its workspace-relative paths). */
  aliases: Record<string, string>;
  /** `api/src/x.ts` → `{ folder: '/repos/api', rel: 'src/x.ts' }`. Single-folder: `folder` is `undefined` and `rel` is the path. */
  split(path: string): { folder: string | undefined; rel: string };
  /** The inverse of {@link split}. */
  join(folder: string | undefined, rel: string): string;
}

export function folderRoutingFor(workspace: Workspace | null | undefined): FolderRouting {
  if (!workspace?.rootPath) return { multi: false, folders: [], aliases: {}, split: (path) => ({ folder: undefined, rel: path }), join: (_f, rel) => rel };
  const folders = workspaceFolders(workspace);
  const multi = folders.length > 1;
  const aliases = folderAliases(workspace);
  const byAlias = new Map(Object.entries(aliases).map(([folder, alias]) => [alias, folder]));
  return {
    multi,
    folders,
    aliases,
    split: (path) => {
      if (!multi) return { folder: undefined, rel: path };
      const [alias = '', ...rest] = path.split('/');
      return { folder: byAlias.get(alias), rel: rest.join('/') };
    },
    join: (folder, rel) => (!multi || folder === undefined ? rel : rel === '' ? aliases[folder] ?? rel : `${aliases[folder]}/${rel}`),
  };
}

/** Folder routing for the open workspace (single-folder until a second folder is added). */
export function useFolderRouting(): FolderRouting {
  const { data } = useActiveWorkspace();
  return folderRoutingFor(data);
}
