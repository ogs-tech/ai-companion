import { WORKSPACE_SOURCE } from '../../shared/entity.js';
import type { Instruction } from '../../shared/entity.js';
import type { Project } from '../../shared/project.js';
import type { Workspace } from '../../shared/workspace.js';

export function basenameFromPath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const raw = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'scope';
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

export function seedProjectInstruction(project: Project): Instruction {
  return {
    urn: '',
    kind: 'instruction',
    name: basenameFromPath(project.path),
    description: '',
    scopes: ['project'],
    scopeId: project.id,
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: WORKSPACE_SOURCE,
    content: `# Instructions do projeto\n\nContext, conventions, and workflows specific to this project.\n`,
  };
}
