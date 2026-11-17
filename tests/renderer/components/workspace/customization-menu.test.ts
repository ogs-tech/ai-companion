import { describe, expect, it } from 'vitest';
import { customizationMenu, type MenuContext } from '../../../../src/renderer/components/workspace/customization-menu.js';

const ctx = (over: Partial<MenuContext> = {}): MenuContext => ({
  entity: { kind: 'skill', name: 'tdd', scopes: ['personal'] },
  enabled: true,
  readOnly: false,
  detected: false,
  canInstallOver: false,
  hasUndo: false,
  newAction: true,
  ...over,
});
const labels = (c: MenuContext): string[] => customizationMenu(c).map((a) => a.label);

describe('customizationMenu', () => {
  it('own skill: Abrir, Editar, Desativar, Excluir, then New Action', () => {
    expect(labels(ctx())).toEqual(['Abrir', 'Editar', 'Desativar', 'Excluir', 'New Action']);
    expect(customizationMenu(ctx()).map((a) => a.key)).toEqual(['open', 'edit', 'toggle', 'delete', 'new-action']);
  });

  it('a disabled item offers Ativar', () => {
    expect(labels(ctx({ enabled: false }))).toContain('Ativar');
  });

  it('the personal instruction cannot be deleted', () => {
    expect(labels(ctx({ entity: { kind: 'instruction', name: 'default', scopes: ['personal'] } }))).not.toContain('Excluir');
  });

  it('Global in a workspace: Abrir and Editar no Início (New Action kept where the row has it)', () => {
    expect(labels(ctx({ readOnly: 'global', newAction: false }))).toEqual(['Abrir', 'Editar no Início']);
    expect(labels(ctx({ readOnly: 'global' }))).toEqual(['Abrir', 'Editar no Início', 'New Action']);
  });

  it('plugin item: Abrir only', () => {
    expect(labels(ctx({ readOnly: 'plugin', newAction: false }))).toEqual(['Abrir']);
  });

  it('toRowActions drops verbs with no handler and marks Excluir destructive', async () => {
    const { toRowActions } = await import('../../../../src/renderer/components/workspace/customization-menu.js');
    const actions = toRowActions(customizationMenu(ctx()), { edit: () => undefined, delete: () => undefined });
    expect(actions.map((a) => a.key)).toEqual(['edit', 'delete']);
    expect(actions[1]?.danger).toBe(true);
  });

  it('detected: Abrir and Importar', () => {
    expect(labels(ctx({ detected: true }))).toEqual(['Abrir', 'Importar']);
  });

  it('installable: Instalar por cima, and Desfazer when there is something to undo', () => {
    expect(labels(ctx({ canInstallOver: true }))).toContain('Instalar por cima');
    expect(labels(ctx({ canInstallOver: true, hasUndo: true }))).toContain('Desfazer');
    expect(labels(ctx())).not.toContain('Instalar por cima');
  });

  it('no New Action where the row has none', () => {
    expect(labels(ctx({ newAction: false }))).toEqual(['Abrir', 'Editar', 'Desativar', 'Excluir']);
  });
});
