import type { Adapter, AdapterDestination } from '../../ports/adapter.js';
import type { Entity, Instruction } from '../../../../shared/entity.js';
import { DomainError } from '../../../domain/errors.js';

export class FakeAdapter implements Adapter {
  constructor(
    public readonly adapterId: string,
    private readonly personalDestination: string,
    private readonly workspaceDestinationTemplate: (scopeId: string) => string = (scopeId) => `${scopeId}/.fake-adapter`,
    /**
     * Optional per-entity failure injection — mirrors how ClaudeAdapter/CursorAdapter
     * can now throw from `resolveEntityDestinations` (via `resolveScopePath`) for an
     * entity with a dangling `scopeId`. Used by AdapterManager error-isolation tests.
     */
    private readonly failFor?: (entity: Entity) => boolean,
  ) {}

  resolveEntityDestinations(args: { entity: Entity }): AdapterDestination[] {
    if (this.failFor?.(args.entity)) {
      throw new DomainError('not_found', `FakeAdapter: no destination resolvable for ${args.entity.urn}`);
    }
    const { scopes } = args.entity;
    const out: AdapterDestination[] = [];

    if (scopes.includes('personal')) {
      out.push({ scope: 'personal', destination: this.personalDestination, strategy: 'symlink' });
    }

    // Only workspace *instructions* get a destination here; skill/agent
    // `workspace` scope is a no-op in this fake.
    if (scopes.includes('workspace') && args.entity.kind === 'instruction') {
      const instruction = args.entity as Instruction;
      out.push({
        scope: 'workspace',
        destination: this.workspaceDestinationTemplate(instruction.scopeId ?? ''),
        strategy: 'symlink',
      });
    }

    return out;
  }
}
