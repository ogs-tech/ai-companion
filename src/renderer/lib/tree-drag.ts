/** MIME type carrying the workspace-relative paths of an in-app Explorer drag, so the editor area can accept a tree file. */
export const TREE_DRAG_TYPE = 'application/x-ai-companion-paths';

/** The paths of an Explorer drag, or `[]` when the drag isn't one of ours. */
export function readTreeDrag(dataTransfer: DataTransfer): string[] {
  const raw = dataTransfer.getData(TREE_DRAG_TYPE);
  if (raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether the drag carries files from outside the app (Finder). */
export function isExternalFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files') && !Array.from(dataTransfer.types).includes(TREE_DRAG_TYPE);
}
