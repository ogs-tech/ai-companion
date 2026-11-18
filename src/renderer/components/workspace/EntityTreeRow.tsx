import { TreeGroupRow } from './TreeGroup.js';
import { RowLabel, RowSignal, rowMuted, rowMutedStyle, rowTestId, useInstallOver } from './RowBadgeSlot.js';
import { RowContextMenu, useRowContextMenu } from './RowContextMenu.js';
import { customizationMenu, toRowActions } from './customization-menu.js';
import { useSetEntityEnabled } from '../../hooks/use-set-entity-enabled.js';
import { useInvalidateCustomization } from '../../hooks/use-customization-list.js';
import { useRequestDelete } from '../../hooks/use-undoable-delete.js';
import { callIpc } from '../../lib/ipc.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import type { TreeItem } from '../../lib/customization-tree.js';
import type { Agent, Skill } from '../../../shared/entity.js';

interface LocalScope {
  scope: 'workspace';
  scopeId: string;
  /** Multi-folder workspaces: the folder (absolute path) a new entity is created in; `null`/absent = the shared set. */
  folder?: string | null;
}

/** A blank entity of `kind`, pre-scoped to the open workspace when there is one. */
export function seedNewEntity(kind: 'skill' | 'agent', localScope: LocalScope | undefined): Skill | Agent {
  const blank = blankCustomization(kind) as Skill | Agent;
  if (!localScope) return blank;
  return {
    ...blank,
    scopes: [localScope.scope],
    scopeId: localScope.scopeId,
    ...(typeof localScope.folder === 'string' ? { folder: localScope.folder } : {}),
  } as Skill | Agent;
}

export interface EntityRowHandlers {
  /** Opens a create/edit tab for this entity in the Workbench. */
  onEdit: (kind: 'skill' | 'agent', entity: Skill | Agent, isCreate: boolean) => void;
  /** Right-click → "Preview": a read-only rendered-Markdown tab. */
  onPreview?: (entity: Skill | Agent) => void;
  /** Right-click → "Properties": the entity's editing tab with its Properties modal. */
  onProperties?: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
  /** Right-click → "New Action": a new session with a draft first message referencing this entity. */
  onNewAction?: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
}

interface EntityTreeRowProps {
  item: TreeItem;
  handlers: EntityRowHandlers;
  depth?: number;
}

/**
 * One skill or agent of the tree; its menu comes from the kind registry. A plugin's is read-only (Visualizar), tagged
 * with the plugin; a Global one seen from a workspace is editable like any other.
 */
export function EntityTreeRow({ item, handlers, depth = 1 }: EntityTreeRowProps): React.ReactElement | null {
  const invalidate = useInvalidateCustomization();
  const requestDelete = useRequestDelete();
  const setEnabled = useSetEntityEnabled();
  const installOver = useInstallOver(item);
  const rowMenu = useRowContextMenu<Skill | Agent>();
  const { entity } = item;
  if (entity.kind !== 'skill' && entity.kind !== 'agent') return null;
  const { kind, value } = entity;
  const fromPlugin = value.source.kind === 'plugin';

  // Hidden at once; the list's undo toast runs the delete when its window ends (errors surface there).
  const handleDelete = (target: Skill | Agent): void =>
    requestDelete({
      key: item.urn,
      message: `"${target.name}" excluído`,
      commit: async () => {
        await callIpc(`${kind}.delete`, { id: target.name, removeSymlinks: true });
        await invalidate(kind);
      },
    });

  const target = rowMenu.state?.target;
  const { onPreview, onProperties, onNewAction } = handlers;
  const actions = target
    ? toRowActions(
        customizationMenu({
          entity: target,
          enabled: target.enabled !== false,
          readOnly: fromPlugin ? 'plugin' : false,
          detected: false,
          canInstallOver: installOver.available,
          hasUndo: false,
          newAction: onNewAction !== undefined,
        }),
        {
          ...(onPreview ? { open: () => onPreview(target) } : {}),
          ...(onProperties ? { edit: () => onProperties(kind, target) } : {}),
          toggle: () => setEnabled.mutate({ urn: target.urn, enabled: target.enabled === false }),
          delete: () => handleDelete(target),
          installOver: installOver.run,
          ...(onNewAction ? { 'new-action': () => onNewAction(kind, target) } : {}),
        },
      )
    : [];
  const open = (): void => {
    if (fromPlugin) onPreview?.(value);
    else handlers.onEdit(kind, value, false);
  };

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        primary={<RowLabel item={item} />}
        depth={depth}
        muted={rowMuted(item)}
        mutedStyle={rowMutedStyle(item)}
        onClick={open}
        onContextMenu={(e) => rowMenu.openMenu(e, value)}
        badge={<RowSignal item={item} usage={{ kind, name: value.name }} anchorUrn={value.urn} />}
      />
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={actions} />
      {installOver.toast}
    </>
  );
}
