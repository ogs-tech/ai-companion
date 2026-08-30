import type { Entity } from '../../../shared/entity.js';
import type { EntityListQuery, EntityRepository } from '../../application/ports/entity-repository.js';
import { DomainError } from '../../domain/errors.js';

export class InMemoryEntityRepository implements EntityRepository {
  private readonly store = new Map<string, Entity>();

  list(query?: EntityListQuery): Promise<Entity[]> {
    const all = [...this.store.values()].map((e) => structuredClone(e));
    return Promise.resolve(query?.kind ? all.filter((e) => e.kind === query.kind) : all);
  }

  get(urn: string): Promise<Entity> {
    const found = this.store.get(urn);
    if (!found) {
      return Promise.reject(new DomainError('not_found', `Entity not found: ${urn}`));
    }
    return Promise.resolve(structuredClone(found));
  }

  save(entity: Entity): Promise<Entity> {
    this.store.set(entity.urn, structuredClone(entity));
    return Promise.resolve(structuredClone(entity));
  }

  delete(urn: string): Promise<void> {
    if (!this.store.has(urn)) {
      return Promise.reject(new DomainError('not_found', `Entity not found: ${urn}`));
    }
    this.store.delete(urn);
    return Promise.resolve();
  }

  exists(urn: string): Promise<boolean> {
    return Promise.resolve(this.store.has(urn));
  }

  filePath(urn: string): Promise<string> {
    if (!this.store.has(urn)) {
      return Promise.reject(new DomainError('not_found', `Entity not found: ${urn}`));
    }
    return Promise.resolve(`/in-memory/${urn}`);
  }
}
