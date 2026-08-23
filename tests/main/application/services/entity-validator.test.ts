import { describe, it, expect } from 'vitest';
import { EntityValidator } from '../../../../src/main/application/services/entity-validator.js';
import { DomainError } from '../../../../src/main/domain/errors.js';
import {
  WORKSPACE_SOURCE,
  type Instruction,
  type Skill,
} from '../../../../src/shared/entity.js';

const v = new EntityValidator();
const meta = { version: '0.1.0', createdAt: '', updatedAt: '' };

describe('EntityValidator', () => {
  it('accepts a valid skill', () => {
    const skill: Skill = { urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(() => v.validate(skill)).not.toThrow();
  });

  it('rejects a bad slug', () => {
    const skill: Skill = { urn: 'urn:skill:Bad', kind: 'skill', name: 'Bad Name', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(() => v.validate(skill)).toThrow();
  });

  it('accepts a valid personal instruction (name=default, scopes=[personal])', () => {
    const good: Instruction = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
      description: '', scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b',
    };
    expect(() => v.validate(good)).not.toThrow();
  });

  it('rejects a personal instruction with a non-default name', () => {
    const bad = {
      urn: 'urn:instruction:other', kind: 'instruction', name: 'other',
      description: '', scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b',
    } as unknown as Instruction;
    expect(() => v.validate(bad)).toThrow();
  });

  it('rejects a personal instruction carrying scopeId', () => {
    const bad = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
      description: '', scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b',
      scopeId: 'proj-1',
    } as unknown as Instruction;
    expect(() => v.validate(bad)).toThrow();
  });

  it('accepts a valid project instruction (scopes=[project] + scopeId)', () => {
    const good: Instruction = {
      urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme',
      description: 'acme project rules', scopes: ['project'], metadata: meta,
      source: WORKSPACE_SOURCE, content: 'b', scopeId: 'proj-1',
    };
    expect(() => v.validate(good)).not.toThrow();
  });

  it('rejects a project instruction with the reserved name "default"', () => {
    const bad = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
      description: '', scopes: ['project'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b',
      scopeId: 'proj-1',
    } as unknown as Instruction;
    expect(() => v.validate(bad)).toThrow();
  });

  it('rejects a project instruction without scopeId', () => {
    const bad = {
      urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme',
      description: '', scopes: ['project'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b',
    } as unknown as Instruction;
    expect(() => v.validate(bad)).toThrow();
  });

  it('rejects a project instruction with an empty-string scopeId', () => {
    const bad = {
      urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme',
      description: '', scopes: ['project'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b',
      scopeId: '',
    } as unknown as Instruction;
    expect(() => v.validate(bad)).toThrow();
  });

  it('rejects an instruction with multi-element scopes tuple', () => {
    const bad = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
      description: '', scopes: ['personal', 'project'], metadata: meta,
      source: WORKSPACE_SOURCE, content: 'b',
    } as unknown as Instruction;
    expect(() => v.validate(bad)).toThrow();
  });

  it('throws a DomainError with kind "validation" and a non-empty details.errors array', () => {
    const skill: Skill = { urn: 'urn:skill:Bad', kind: 'skill', name: 'Bad Name', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };

    let caught: unknown;
    try {
      v.validate(skill);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DomainError);
    const domainError = caught as DomainError;
    expect(domainError.kind).toBe('validation');
    const errors = domainError.details?.errors;
    expect(Array.isArray(errors)).toBe(true);
    expect((errors as unknown[]).length).toBeGreaterThan(0);
    const first = (errors as Array<Record<string, unknown>>)[0];
    expect(first).toHaveProperty('path');
    expect(first).toHaveProperty('message');
    expect(typeof first?.path).toBe('string');
    expect(typeof first?.message).toBe('string');
  });

  it('rejects a skill with an empty description', () => {
    const skill: Skill = { urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: '',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(() => v.validate(skill)).toThrow();
  });

  // TODO(follow-up): remove this block when skill/agent regain a per-entity
  // repoPath and can once again target 'project' scope.
  it('temporarily rejects a project-scoped skill (linkedRepos removal)', () => {
    const skill = { urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd',
      scopes: ['project'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' } as unknown as Skill;
    expect(() => v.validate(skill)).toThrow();
  });
});
