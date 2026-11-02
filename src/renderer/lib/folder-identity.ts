/**
 * Folder identity in the UI: a short name and one colour per folder, used
 * everywhere a folder shows up (tree, git, terminals, chips). The workspace's
 * own shared set is neutral.
 */

export const basename = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed;
};

/** Fixed palette; a folder takes the colour of its position in the workspace. Distinguishable on the dark theme. */
export const FOLDER_PALETTE = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171'] as const;

/** The workspace's shared set — neutral. */
export const SHARED_COLOR = '#d4d4d8';

export function folderColor(folders: readonly string[], folder: string | undefined): string {
  if (folder === undefined) return SHARED_COLOR;
  const index = Math.max(0, folders.indexOf(folder));
  return FOLDER_PALETTE[index % FOLDER_PALETTE.length] as string;
}
