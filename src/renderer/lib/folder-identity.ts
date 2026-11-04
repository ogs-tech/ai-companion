/** Folder identity in the UI: a folder is known by its name (last path segment). */

export const basename = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed;
};
