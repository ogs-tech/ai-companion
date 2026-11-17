import { describe, expect, it } from 'vitest';
import { CUSTOMIZATION_KINDS, itemVerbs, kindSpec, toggleLabel, VERB_LABEL } from '../../src/shared/customization-kind.js';

describe('customization kind registry', () => {
  it('lists the kinds in tree order', () => {
    expect(CUSTOMIZATION_KINDS.map((k) => k.kind)).toEqual(['instruction', 'skill', 'agent', 'mcp', 'hook']);
  });

  it('declares every lifecycle verb for every kind', () => {
    for (const spec of CUSTOMIZATION_KINDS) {
      expect([...spec.verbs].sort()).toEqual(['delete', 'edit', 'import', 'installOver', 'toggle']);
    }
  });

  it('maps each kind to its editor', () => {
    expect(kindSpec('hook').editor).toBe('hook-dialog');
    expect(kindSpec('mcp').editor).toBe('mcp-dialog');
    expect(kindSpec('skill').editor).toBe('properties');
    expect(kindSpec('agent').editor).toBe('properties');
    expect(kindSpec('instruction').editor).toBe('properties');
  });

  it('keeps the current group labels', () => {
    expect(CUSTOMIZATION_KINDS.map((k) => k.label)).toEqual(['Instruções', 'Skills', 'Agents', 'MCP', 'Hooks']);
  });

  it('throws for an unknown kind', () => {
    expect(() => kindSpec('plugin' as never)).toThrow();
  });

  it('drops delete for the personal instruction singleton only', () => {
    expect(itemVerbs({ kind: 'instruction', name: 'default', scopes: ['personal'] })).not.toContain('delete');
    expect(itemVerbs({ kind: 'instruction', name: 'repo', scopes: ['workspace'] })).toContain('delete');
    expect(itemVerbs({ kind: 'skill', name: 'tdd', scopes: ['personal'] })).toContain('delete');
  });

  it('labels verbs in Portuguese', () => {
    expect(VERB_LABEL).toEqual({ edit: 'Editar', delete: 'Excluir', import: 'Importar', installOver: 'Instalar por cima' });
    expect(toggleLabel(true)).toBe('Desativar');
    expect(toggleLabel(false)).toBe('Ativar');
  });
});
