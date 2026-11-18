import { describe, expect, it } from 'vitest';
import { customizationMenu, toRowActions, type MenuContext } from '../../../../src/renderer/components/workspace/customization-menu.js';

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
  it('own skill: Visualizar, Editar, Desativar, Nova sessão, then Excluir last', () => {
    expect(labels(ctx())).toEqual(['Visualizar', 'Editar', 'Desativar', 'Nova sessão', 'Excluir']);
    expect(customizationMenu(ctx()).map((a) => a.key)).toEqual(['open', 'edit', 'toggle', 'new-action', 'delete']);
  });

  it('a disabled item leads with Ativar, the action that resolves its signal', () => {
    const menu = customizationMenu(ctx({ enabled: false }));
    expect(menu.map((a) => a.label)).toEqual(['Ativar', 'Visualizar', 'Editar', 'Nova sessão', 'Excluir']);
    expect(menu[0]?.primary).toBe(true);
  });

  it('the personal instruction cannot be deleted', () => {
    expect(labels(ctx({ entity: { kind: 'instruction', name: 'default', scopes: ['personal'] } }))).not.toContain('Excluir');
  });

  it('plugin item: Visualizar only', () => {
    expect(labels(ctx({ readOnly: 'plugin', newAction: false }))).toEqual(['Visualizar']);
  });

  it('toRowActions drops verbs with no handler and marks Excluir destructive', async () => {
    const { toRowActions } = await import('../../../../src/renderer/components/workspace/customization-menu.js');
    const actions = toRowActions(customizationMenu(ctx()), { edit: () => undefined, delete: () => undefined });
    expect(actions.map((a) => a.key)).toEqual(['edit', 'delete']);
    expect(actions[1]?.danger).toBe(true);
  });

  it('detected: Importar first, then Visualizar', () => {
    expect(labels(ctx({ detected: true }))).toEqual(['Importar', 'Visualizar']);
  });

  it('installable: Instalar por cima first, and Desfazer right after when there is something to undo', () => {
    expect(labels(ctx({ canInstallOver: true }))[0]).toBe('Instalar por cima');
    expect(labels(ctx({ canInstallOver: true, hasUndo: true })).slice(0, 2)).toEqual(['Instalar por cima', 'Desfazer']);
    expect(labels(ctx())).not.toContain('Instalar por cima');
  });

  it('no Nova sessão where the row has none', () => {
    expect(labels(ctx({ newAction: false }))).toEqual(['Visualizar', 'Editar', 'Desativar', 'Excluir']);
  });
});

describe('toRowActions', () => {
  const all = { open: () => undefined, edit: () => undefined, toggle: () => undefined, delete: () => undefined, import: () => undefined, installOver: () => undefined, undo: () => undefined };

  it('emphasizes the primary action and sets the rest apart with a divider', () => {
    const actions = toRowActions(customizationMenu(ctx({ canInstallOver: true, hasUndo: true, newAction: false })), all);
    expect(actions.map((a) => [a.key, a.emphasis === true, a.separatorBefore === true])).toEqual([
      ['installOver', true, false],
      ['undo', false, false],
      ['open', false, true],
      ['edit', false, false],
      ['toggle', false, false],
      ['delete', false, false],
    ]);
    expect(actions.at(-1)?.danger).toBe(true);
  });

  it('no divider when nothing is primary', () => {
    expect(toRowActions(customizationMenu(ctx({ newAction: false })), all).some((a) => a.separatorBefore === true)).toBe(false);
  });
});
