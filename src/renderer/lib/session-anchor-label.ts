import { parseUrn } from '../../shared/entity.js';
import type { SessionAnchor } from '../../shared/session.js';

const ENTITY_KIND_LABEL: Record<string, string> = {
  skill: 'Skill',
  agent: 'Agent',
  instruction: 'Instruction',
};

export function anchorKindLabel(anchor: SessionAnchor): string {
  if (anchor.kind === 'workspace') return 'Workspace';
  if (anchor.kind === 'project') return 'Project';
  return ENTITY_KIND_LABEL[parseUrn(anchor.urn).kind] ?? 'Entity';
}
