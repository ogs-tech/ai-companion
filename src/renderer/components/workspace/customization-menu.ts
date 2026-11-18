import { ArrowDownToLine, Download, Eye, Pencil, Power, SquareTerminal, Trash2, Undo2, type LucideIcon } from 'lucide-react';
import { itemVerbs, toggleLabel, VERB_LABEL, type CustomizationVerb } from '../../../shared/customization-kind.js';
import type { Entity } from '../../../shared/entity.js';
import type { RowContextMenuAction } from './RowContextMenu.js';

export interface MenuContext {
  entity: Pick<Entity, 'kind' | 'name' | 'scopes'>;
  enabled: boolean;
  /** `plugin`: shipped by a plugin, opens read-only. */
  readOnly: false | 'plugin';
  /** Found in a channel's own files, not yet the app's. */
  detected: boolean;
  /** A file the app doesn't own sits where the item goes. */
  canInstallOver: boolean;
  hasUndo: boolean;
  /** The row can start a session about the item (not a lifecycle verb — it goes last, after a divider). */
  newAction: boolean;
}

export type MenuActionKey = CustomizationVerb | 'undo' | 'open' | 'new-action';

export interface MenuAction {
  key: MenuActionKey;
  label: string;
  /** Resolves what the row's signal says (Importar, Instalar por cima, Ativar): drawn first and set apart. */
  primary?: boolean;
}

/**
 * The one menu every customization row shows, from the kind registry: no row decides by itself which verbs exist.
 * Fixed order — the action that resolves the row's signal, Visualizar, Editar, Ativar/Desativar, Nova sessão,
 * Excluir last. Read-only and detected rows get their own short menus; a verb the item can't do is left out, never
 * disabled.
 */
export function customizationMenu(ctx: MenuContext): MenuAction[] {
  const newAction: MenuAction[] = ctx.newAction ? [{ key: 'new-action', label: 'Nova sessão' }] : [];
  if (ctx.readOnly !== false) {
    return [{ key: 'open', label: 'Visualizar' }, ...newAction];
  }
  if (ctx.detected) return [{ key: 'import', label: VERB_LABEL.import, primary: true }, { key: 'open', label: 'Visualizar' }];

  const verbs = new Set(itemVerbs(ctx.entity));
  const primary: MenuAction[] = [];
  if (verbs.has('installOver') && ctx.canInstallOver) {
    primary.push({ key: 'installOver', label: VERB_LABEL.installOver, primary: true });
    if (ctx.hasUndo) primary.push({ key: 'undo', label: 'Desfazer' });
  } else if (verbs.has('toggle') && !ctx.enabled) {
    primary.push({ key: 'toggle', label: toggleLabel(ctx.enabled), primary: true });
  }
  // Visualizar = today's read-only Preview, kept on own rows too (dropped by `toRowActions` where a row has no preview).
  const out: MenuAction[] = [...primary, { key: 'open', label: 'Visualizar' }];
  if (verbs.has('edit')) out.push({ key: 'edit', label: VERB_LABEL.edit });
  if (verbs.has('toggle') && !primary.some((a) => a.key === 'toggle')) out.push({ key: 'toggle', label: toggleLabel(ctx.enabled) });
  out.push(...newAction);
  if (verbs.has('delete')) out.push({ key: 'delete', label: VERB_LABEL.delete });
  return out;
}

const GLYPH: Record<MenuActionKey, LucideIcon> = {
  edit: Pencil,
  toggle: Power,
  delete: Trash2,
  import: Download,
  installOver: ArrowDownToLine,
  undo: Undo2,
  open: Eye,
  'new-action': SquareTerminal,
};

/**
 * Turns the menu into the row's context-menu actions. A verb the row has no handler for is left out (the rule is
 * "omit, never disable"); the primary action is emphasized with a divider after it, and Excluir is drawn as
 * destructive.
 */
export function toRowActions(menu: readonly MenuAction[], handlers: Partial<Record<MenuActionKey, () => void>>): RowContextMenuAction[] {
  const out: RowContextMenuAction[] = [];
  let afterPrimary = false;
  for (const { key, label, primary } of menu) {
    const onSelect = handlers[key];
    if (onSelect === undefined) continue;
    out.push({
      key,
      label,
      glyph: GLYPH[key],
      onSelect,
      ...(primary === true ? { emphasis: true } : {}),
      ...(afterPrimary && primary !== true && key !== 'undo' ? { separatorBefore: true } : {}),
      ...(key === 'delete' ? { danger: true } : {}),
    });
    if (primary === true) afterPrimary = true;
    else if (key !== 'undo') afterPrimary = false;
  }
  return out;
}
