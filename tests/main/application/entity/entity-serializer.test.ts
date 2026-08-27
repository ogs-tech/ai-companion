import { describe, it, expect } from 'vitest';
import { renderEntityFile, parseEntityFile } from '../../../../src/main/application/entity/entity-serializer.js';
import { WORKSPACE_SOURCE, type Skill, type Agent, type Instruction } from '../../../../src/shared/entity.js';

const baseMeta = { version: '0.1.0', createdAt: '2026-04-26T10:00:00.000Z', updatedAt: '2026-04-26T10:00:00.000Z' };

describe('renderEntityFile — skill', () => {
  it('emits flat Claude frontmatter and the content as body', () => {
    const skill: Skill = {
      urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'a demo',
      scopes: ['personal'], metadata: baseMeta, source: WORKSPACE_SOURCE, content: '# Demo\n',
    };
    const raw = renderEntityFile(skill);
    expect(raw).toContain('name: demo');
    expect(raw).toContain('type: skill');
    expect(raw).toContain('version: 0.1.0');
    expect(raw).toContain('# Demo');
    expect(raw).not.toContain('disable-model-invocation');
  });

  it('maps explicitOnly to disable-model-invocation: true', () => {
    const skill: Skill = {
      urn: 'urn:skill:cmd', kind: 'skill', name: 'cmd', description: 'a command skill',
      scopes: ['personal'], metadata: baseMeta, source: WORKSPACE_SOURCE, content: 'body', explicitOnly: true,
    };
    expect(renderEntityFile(skill)).toContain('disable-model-invocation: true');
  });
});

describe('parseEntityFile — skill round-trip', () => {
  it('round-trips scopeId through frontmatter for a project-scoped skill', () => {
    const skill: Skill = {
      urn: 'urn:skill:acme', kind: 'skill', name: 'acme', description: 'project skill',
      scopes: ['project'], scopeId: 'proj-1', metadata: baseMeta, source: WORKSPACE_SOURCE, content: 'body',
    };
    const raw = renderEntityFile(skill);
    expect(raw).toContain('scopeId: proj-1');

    const parsed = parseEntityFile({ kind: 'skill', name: 'acme', raw, source: WORKSPACE_SOURCE }) as Skill;
    expect(parsed.scopes).toEqual(['project']);
    expect(parsed.scopeId).toBe('proj-1');
    // scopeId must not also leak into ext (it's a known key, not passthrough).
    expect(parsed.ext).toBeUndefined();
  });

  it('emits no scopeId for a personal skill and parses none back', () => {
    const skill: Skill = {
      urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'a demo',
      scopes: ['personal'], metadata: baseMeta, source: WORKSPACE_SOURCE, content: 'body',
    };
    const raw = renderEntityFile(skill);
    expect(raw).not.toContain('scopeId');
    const parsed = parseEntityFile({ kind: 'skill', name: 'demo', raw, source: WORKSPACE_SOURCE }) as Skill;
    expect(parsed.scopeId).toBeUndefined();
  });

  it('parses frontmatter back into a canonical skill with ext passthrough', () => {
    const raw = [
      '---', 'name: demo', 'type: skill', 'description: a demo',
      'scopes:', '  - personal', 'version: 0.1.0',
      'createdAt: 2026-04-26T10:00:00.000Z', 'updatedAt: 2026-04-26T10:00:00.000Z',
      'license: MIT', 'disable-model-invocation: true', '---', '# Demo', '',
    ].join('\n');
    const entity = parseEntityFile({ kind: 'skill', name: 'demo', raw, source: WORKSPACE_SOURCE }) as Skill;
    expect(entity.urn).toBe('urn:skill:demo');
    expect(entity.name).toBe('demo');
    expect(entity.description).toBe('a demo');
    expect(entity.metadata.version).toBe('0.1.0');
    expect(entity.explicitOnly).toBe(true);
    expect(entity.content.trim()).toBe('# Demo');
    expect(entity.ext).toEqual({ license: 'MIT' });
  });
});

describe('agent', () => {
  it('maps systemPrompt to body and model/tools to frontmatter', () => {
    const agent: Agent = {
      urn: 'urn:agent:rev', kind: 'agent', name: 'rev', description: 'reviewer',
      scopes: ['personal'], metadata: baseMeta, source: WORKSPACE_SOURCE,
      systemPrompt: 'You review code.', model: 'inherit', tools: ['Read', 'Grep'],
    };
    const raw = renderEntityFile(agent);
    expect(raw).toContain('model: inherit');
    expect(raw).toContain('You review code.');
    const parsed = parseEntityFile({ kind: 'agent', name: 'rev', raw, source: WORKSPACE_SOURCE }) as Agent;
    expect(parsed.systemPrompt.trim()).toBe('You review code.');
    expect(parsed.model).toBe('inherit');
    expect(parsed.tools).toEqual(['Read', 'Grep']);
  });

  it('round-trips scopeId through frontmatter for a workspace-scoped agent', () => {
    const agent: Agent = {
      urn: 'urn:agent:triage', kind: 'agent', name: 'triage', description: 'triage agent',
      scopes: ['workspace'], scopeId: 'ws-1', metadata: baseMeta, source: WORKSPACE_SOURCE,
      systemPrompt: 'Triage incoming issues.',
    };
    const raw = renderEntityFile(agent);
    expect(raw).toContain('scopeId: ws-1');
    const parsed = parseEntityFile({ kind: 'agent', name: 'triage', raw, source: WORKSPACE_SOURCE }) as Agent;
    expect(parsed.scopes).toEqual(['workspace']);
    expect(parsed.scopeId).toBe('ws-1');
  });
});

describe('instruction — frontmatter-free', () => {
  it('renders plain markdown with no frontmatter', () => {
    const ins: Instruction = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default', description: '',
      scopes: ['personal'], metadata: baseMeta, source: WORKSPACE_SOURCE,
      content: '# Global instructions\nReply in pt-BR.\n',
    };
    const raw = renderEntityFile(ins);
    expect(raw.startsWith('---')).toBe(false);
    expect(raw).toContain('# Global instructions');
  });

  it('parses a legacy file by stripping any frontmatter, defaulting sidecar', () => {
    const legacy = ['---', 'name: default', 'type: global-instruction', '---', '# Hi', ''].join('\n');
    const ins = parseEntityFile({ kind: 'instruction', name: 'default', raw: legacy, source: WORKSPACE_SOURCE }) as Instruction;
    expect(ins.content.trim()).toBe('# Hi');
    expect(ins.scopes).toEqual(['personal']);
    expect(ins.name).toBe('default');
    expect(ins.metadata.version).toBe('0.0.0');
  });

  it('uses instructionSidecar when provided (personal)', () => {
    const raw = '# Body\n';
    const ins = parseEntityFile({
      kind: 'instruction', name: 'default', raw, source: WORKSPACE_SOURCE,
      instructionSidecar: {
        description: 'Personal profile', version: '1.2.3',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      },
    }) as Instruction;
    expect(ins.name).toBe('default');
    expect(ins.scopes).toEqual(['personal']);
    expect(ins.description).toBe('Personal profile');
    expect(ins.metadata.version).toBe('1.2.3');
  });

  it('emits a project instruction with scopeId when sidecar.scopeId is present', () => {
    const raw = '# Body\n';
    const ins = parseEntityFile({
      kind: 'instruction', name: 'acme', raw, source: WORKSPACE_SOURCE,
      instructionSidecar: {
        description: 'Acme rules', version: '0.1.0', createdAt: '', updatedAt: '',
        scope: 'project', scopeId: 'proj-1',
      },
    }) as Instruction;
    expect(ins.name).toBe('acme');
    expect(ins.scopes).toEqual(['project']);
    expect(ins.scopeId).toBe('proj-1');
    expect(ins.legacyRepoPath).toBeUndefined();
  });

  it('emits a workspace-scoped instruction when sidecar.scope is "workspace"', () => {
    const raw = '# Body\n';
    const ins = parseEntityFile({
      kind: 'instruction', name: 'ws-wide', raw, source: WORKSPACE_SOURCE,
      instructionSidecar: {
        description: 'Workspace rules', version: '0.1.0', createdAt: '', updatedAt: '',
        scope: 'workspace', scopeId: 'ws-1',
      },
    }) as Instruction;
    expect(ins.scopes).toEqual(['workspace']);
    expect(ins.scopeId).toBe('ws-1');
  });

  it('flags a legacy repoPath sidecar as scopes:["project"] with legacyRepoPath, no scopeId', () => {
    const raw = '# Body\n';
    const ins = parseEntityFile({
      kind: 'instruction', name: 'acme', raw, source: WORKSPACE_SOURCE,
      instructionSidecar: {
        description: 'Acme rules', version: '0.1.0', createdAt: '', updatedAt: '',
        repoPath: '/Users/me/projects/acme',
      },
    }) as Instruction;
    expect(ins.scopes).toEqual(['project']);
    expect(ins.scopeId).toBeUndefined();
    expect(ins.legacyRepoPath).toBe('/Users/me/projects/acme');
  });

  it('throws when a non-personal instruction has neither scopeId nor legacy repoPath', () => {
    expect(() =>
      parseEntityFile({ kind: 'instruction', name: 'acme', raw: 'x', source: WORKSPACE_SOURCE }),
    ).toThrow(/scopeId/);
  });
});
