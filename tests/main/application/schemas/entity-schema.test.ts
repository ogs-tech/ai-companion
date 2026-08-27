import { describe, it, expect } from 'vitest';
import {
  agentEntitySchema,
  instructionEntitySchema,
  skillEntitySchema,
} from '../../../../src/main/application/schemas/entity-schema.js';
import { WORKSPACE_SOURCE } from '../../../../src/shared/entity.js';

const meta = { version: '0.1.0', createdAt: '', updatedAt: '' };
const base = {
  urn: 'urn:instruction:x', kind: 'instruction' as const, description: '',
  metadata: meta, source: WORKSPACE_SOURCE, content: '# Body\n',
};

describe('instructionEntitySchema', () => {
  it('accepts the personal singleton with no scopeId', () => {
    const result = instructionEntitySchema.safeParse({ ...base, name: 'default', scopes: ['personal'] });
    expect(result.success).toBe(true);
  });

  it('rejects a personal instruction carrying a scopeId', () => {
    const result = instructionEntitySchema.safeParse({
      ...base, name: 'default', scopes: ['personal'], scopeId: 'proj-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name "default" for a project-scoped instruction', () => {
    const result = instructionEntitySchema.safeParse({
      ...base, name: 'default', scopes: ['project'], scopeId: 'proj-1',
    });
    expect(result.success).toBe(false);
  });

  it('requires a non-empty scopeId for project scope', () => {
    const result = instructionEntitySchema.safeParse({ ...base, name: 'acme', scopes: ['project'] });
    expect(result.success).toBe(false);
  });

  it('accepts a workspace-scoped instruction with a scopeId', () => {
    const result = instructionEntitySchema.safeParse({
      ...base, name: 'ws-wide', scopes: ['workspace'], scopeId: 'ws-1',
    });
    expect(result.success).toBe(true);
  });

  it('requires a non-empty scopeId for workspace scope too', () => {
    const result = instructionEntitySchema.safeParse({ ...base, name: 'ws-wide', scopes: ['workspace'] });
    expect(result.success).toBe(false);
  });
});

describe.each([
  ['skillEntitySchema', skillEntitySchema, { kind: 'skill' as const, content: 'body' }],
  ['agentEntitySchema', agentEntitySchema, { kind: 'agent' as const, systemPrompt: 'body' }],
])('%s scopes', (_label, schema, kindFields) => {
  const skillAgentBase = {
    urn: 'urn:x:y', description: 'd', name: 'demo',
    metadata: meta, source: WORKSPACE_SOURCE, ...kindFields,
  };

  it('accepts scopes: ["personal"] with no scopeId', () => {
    const result = schema.safeParse({ ...skillAgentBase, scopes: ['personal'] });
    expect(result.success).toBe(true);
  });

  it('rejects scopes: ["personal"] carrying a scopeId', () => {
    const result = schema.safeParse({ ...skillAgentBase, scopes: ['personal'], scopeId: 'proj-1' });
    expect(result.success).toBe(false);
  });

  it('accepts scopes: ["project"] with a scopeId', () => {
    const result = schema.safeParse({ ...skillAgentBase, scopes: ['project'], scopeId: 'proj-1' });
    expect(result.success).toBe(true);
  });

  it('rejects scopes: ["project"] with a missing scopeId', () => {
    const result = schema.safeParse({ ...skillAgentBase, scopes: ['project'] });
    expect(result.success).toBe(false);
  });

  it('rejects scopes: ["project"] with an empty scopeId', () => {
    const result = schema.safeParse({ ...skillAgentBase, scopes: ['project'], scopeId: '  ' });
    expect(result.success).toBe(false);
  });

  it('accepts scopes: ["workspace"] with a scopeId', () => {
    const result = schema.safeParse({ ...skillAgentBase, scopes: ['workspace'], scopeId: 'ws-1' });
    expect(result.success).toBe(true);
  });

  it('rejects scopes: ["workspace"] with a missing scopeId', () => {
    const result = schema.safeParse({ ...skillAgentBase, scopes: ['workspace'] });
    expect(result.success).toBe(false);
  });
});
