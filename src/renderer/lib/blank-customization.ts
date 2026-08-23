import type { Agent, Instruction, Skill } from '../../shared/entity.js';
import { WORKSPACE_SOURCE } from '../../shared/entity.js';

/**
 * Build an empty entity pre-filled with sensible defaults for a "New" create
 * flow. `instruction` here means the personal singleton (name === 'default',
 * scopes === ['personal']). Project instructions are seeded via a separate
 * helper because they require a Project picked from the registry.
 */
export function blankCustomization(kind: 'skill' | 'agent' | 'instruction'): Skill | Agent | Instruction {
  const metadata = { version: '0.1.0', createdAt: '', updatedAt: '' };
  if (kind === 'agent') {
    return { urn: '', kind: 'agent', name: '', description: '', scopes: ['personal'], metadata, source: WORKSPACE_SOURCE, systemPrompt: '' };
  }
  if (kind === 'instruction') {
    return { urn: '', kind: 'instruction', name: 'default', description: '', scopes: ['personal'], metadata, source: WORKSPACE_SOURCE, content: '' };
  }
  return { urn: '', kind: 'skill', name: '', description: '', scopes: ['personal'], metadata, source: WORKSPACE_SOURCE, content: '' };
}
