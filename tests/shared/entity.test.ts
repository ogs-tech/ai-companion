import { describe, it, expect } from 'vitest';
import {
  entityUrn,
  parseUrn,
  isPluginSource,
  isWorkspaceSource,
  isPersonalInstruction,
  isProjectInstruction,
  WORKSPACE_SOURCE,
  type Instruction,
  type Skill,
} from '../../src/shared/entity.js';

describe('entityUrn', () => {
  it('derives urn:{kind}:{name}', () => {
    expect(entityUrn('skill', 'code-review')).toBe('urn:skill:code-review');
    expect(entityUrn('instruction', 'default')).toBe('urn:instruction:default');
  });
});

describe('parseUrn', () => {
  it('round-trips a urn back to kind + name', () => {
    expect(parseUrn('urn:mcp:figma')).toEqual({ kind: 'mcp', name: 'figma' });
  });

  it('keeps colons that appear in the name segment', () => {
    expect(parseUrn('urn:hook:pre:commit')).toEqual({ kind: 'hook', name: 'pre:commit' });
  });

  it('throws on a malformed urn', () => {
    expect(() => parseUrn('not-a-urn')).toThrow(/Invalid URN/);
  });
});

describe('source guards', () => {
  it('classifies workspace and plugin sources', () => {
    expect(isWorkspaceSource(WORKSPACE_SOURCE)).toBe(true);
    expect(isPluginSource({ kind: 'plugin', pluginId: 'p', provenance: 'workspace-managed' })).toBe(true);
  });
});

describe('Skill type', () => {
  it('is assignable with the canonical shape', () => {
    const skill: Skill = {
      urn: 'urn:skill:demo',
      kind: 'skill',
      name: 'demo',
      description: 'a demo skill',
      scopes: ['personal'],
      metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
      source: WORKSPACE_SOURCE,
      content: '# Demo\n',
    };
    expect(skill.kind).toBe('skill');
  });
});

describe('Instruction scoping', () => {
  const base = {
    urn: 'urn:instruction:x',
    kind: 'instruction' as const,
    description: '',
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: WORKSPACE_SOURCE,
    content: '# Body\n',
  };

  it('isPersonalInstruction / isProjectInstruction read scopes[0]', () => {
    const personal: Instruction = { ...base, name: 'default', scopes: ['personal'] };
    const project: Instruction = { ...base, name: 'acme', scopes: ['project'], scopeId: 'proj-1' };
    expect(isPersonalInstruction(personal)).toBe(true);
    expect(isProjectInstruction(personal)).toBe(false);
    expect(isProjectInstruction(project)).toBe(true);
    expect(isPersonalInstruction(project)).toBe(false);
  });

  it('accepts a workspace-scoped instruction with scopeId', () => {
    const workspaceScoped: Instruction = {
      ...base, name: 'ws-wide', scopes: ['workspace'], scopeId: 'ws-1',
    };
    expect(workspaceScoped.scopes[0]).toBe('workspace');
    expect(workspaceScoped.scopeId).toBe('ws-1');
  });

  it('carries legacyRepoPath instead of scopeId for pre-migration data', () => {
    const legacy: Instruction = {
      ...base, name: 'legacy-acme', scopes: ['project'], legacyRepoPath: '/repos/legacy-acme',
    };
    expect(legacy.scopeId).toBeUndefined();
    expect(legacy.legacyRepoPath).toBe('/repos/legacy-acme');
  });
});
