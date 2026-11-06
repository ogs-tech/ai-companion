import { folderAliases, workspaceFolders, type Workspace } from './workspace.js';

/** Lowercase, dash-separated, ≤64 chars: the slug rules `projectInstructionSlug` enforces. */
export function instructionSlug(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'scope'
  );
}

/**
 * The name a workspace-level instruction gets by default: the slug of its first
 * folder's basename (the workspace-wide one, or the only one of a single-folder workspace).
 */
export function workspaceInstructionName(workspace: Pick<Workspace, 'rootPath' | 'extraFolders'>): string {
  return instructionSlug(folderAliases(workspace)[workspace.rootPath] ?? workspace.rootPath);
}

/**
 * The name a folder's instruction gets in a multi-folder workspace: the folder's alias slug.
 * An instruction's urn is global to the workspace, so a name already taken (the
 * workspace-wide instruction is seeded with the primary folder's name) gets `-folder`.
 */
export function folderInstructionName(
  workspace: Pick<Workspace, 'rootPath' | 'extraFolders'>,
  folder: string,
  takenNames: ReadonlySet<string>,
): string {
  if (!workspaceFolders(workspace).includes(folder)) return instructionSlug(folder);
  const base = instructionSlug(folderAliases(workspace)[folder] ?? folder);
  return takenNames.has(base) ? `${base}-folder`.slice(0, 64) : base;
}
