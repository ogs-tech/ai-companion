import { WORKSPACE_SOURCE } from '../../shared/entity.js';
import type { Instruction } from '../../shared/entity.js';
import { folderInstructionName, instructionSlug } from '../../shared/instruction-names.js';
import type { Workspace } from '../../shared/workspace.js';

export function basenameFromPath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return instructionSlug(idx >= 0 ? trimmed.slice(idx + 1) : trimmed);
}

export function seedWorkspaceInstruction(workspace: Workspace): Instruction {
  return {
    urn: '',
    kind: 'instruction',
    name: basenameFromPath(workspace.rootPath),
    description: '',
    scopes: ['workspace'],
    scopeId: workspace.id,
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: WORKSPACE_SOURCE,
    content: `# Instructions do workspace\n\nContext, conventions, and workflows specific to this workspace.\n`,
  };
}

/**
 * A fresh, unsaved instruction for one folder of a multi-folder workspace.
 * `takenNames` are the instruction names already in use (urns are workspace-wide).
 */
export function seedFolderInstruction(workspace: Workspace, folder: string, takenNames: ReadonlySet<string>): Instruction {
  return {
    ...seedWorkspaceInstruction(workspace),
    name: folderInstructionName(workspace, folder, takenNames),
    folder,
    content: `# Instructions da pasta\n\nContext and conventions specific to this folder. They apply on top of the workspace's and Global's.\n`,
  };
}
