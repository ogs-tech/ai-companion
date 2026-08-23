import type { Adapter, AdapterDestination } from '../../ports/adapter.js';
import type { Entity, Instruction } from '../../../../shared/entity.js';
import { DomainError } from '../../../domain/errors.js';

export class FakeAdapter implements Adapter {
  constructor(
    public readonly adapterId: string,
    private readonly personalDestination: string,
    private readonly projectDestinationTemplate: (repoPath: string) => string = (repoPath) => `${repoPath}/.fake-adapter`,
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

    // Since linkedRepos was removed, only project *instructions* carry their
    // own repoPath. Everything else (skill/agent 'project' scope) is a no-op
    // until per-entity repoPath lands for those kinds too.
    if (scopes.includes('project') && args.entity.kind === 'instruction') {
      const project = args.entity as Instruction;
      out.push({
        scope: 'project',
        destination: this.projectDestinationTemplate(project.scopeId ?? ''),
        strategy: 'symlink',
      });
    }

    return out;
  }
}
