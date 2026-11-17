import { Stack } from '@mui/material';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import { SessionsUsingBadge } from './SessionsUsingBadge.js';
import { TreeGroupRow } from './TreeGroup.js';
import { PluginTag, RowBadgeSlot, RowLabel, rowMuted, rowTestId, useInstallOver } from './RowBadgeSlot.js';
import { RowContextMenu, useRowContextMenu } from './RowContextMenu.js';
import { customizationMenu, toRowActions } from './customization-menu.js';
import { useSetEntityEnabled } from '../../hooks/use-set-entity-enabled.js';
import { ENTITY_GROUP_ICONS } from '../shell/nav.js';
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
  /** Workspace only: opens a Global entity read-only, with an "Editar no Início" action. */
  onOpenInherited: (entity: Skill | Agent, kind: 'skill' | 'agent') => void;
  /** Right-click → "Preview": a read-only rendered-Markdown tab. */
  onPreview?: (entity: Skill | Agent) => void;
  /** Right-click → "Properties": the entity's editing tab with its Properties modal. */
  onProperties?: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
  /** Right-click → "New Action": a new session with a draft first message referencing this entity. */
  onNewAction?: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
  /** Workspace only: "Editar no Início" on a Global entity — leaves the workspace and opens it editable there. */
  onEditAtHome?: (entity: Skill | Agent, kind: 'skill' | 'agent') => void;
}

interface EntityTreeRowProps {
  item: TreeItem;
  handlers: EntityRowHandlers;
  depth?: number;
}

/**
 * One skill or agent of the tree; its menu comes from the kind registry. A Global one is read-only here (Abrir,
 * Editar no Início); so is a plugin's, tagged with the plugin.
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
  const inherited = item.origin === 'global';
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
  const { onPreview, onProperties, onNewAction, onEditAtHome } = handlers;
  const actions = target
    ? toRowActions(
        customizationMenu({
          entity: target,
          enabled: target.enabled !== false,
          readOnly: fromPlugin ? 'plugin' : inherited ? 'global' : false,
          detected: false,
          canInstallOver: installOver.available,
          hasUndo: false,
          newAction: onNewAction !== undefined,
        }),
        {
          ...(onPreview ? { open: () => onPreview(target) } : {}),
          ...(onEditAtHome ? { 'edit-home': () => onEditAtHome(target, kind) } : {}),
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
    else if (inherited) handlers.onOpenInherited(value, kind);
    else handlers.onEdit(kind, value, false);
  };

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        glyph={ENTITY_GROUP_ICONS[kind]}
        primary={<RowLabel item={item} />}
        mono
        depth={depth}
        muted={rowMuted(item)}
        onClick={open}
        onContextMenu={(e) => rowMenu.openMenu(e, value)}
        badge={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            {item.pluginTag !== undefined && <PluginTag pluginId={item.pluginTag} />}
            <SessionsUsingBadge usage={{ kind, name: value.name }} testId={`${rowTestId(item)}-using`} />
            <SessionStatusBadge anchor={{ kind: 'entity', urn: value.urn }} />
            <RowBadgeSlot item={item} />
          </Stack>
        }
      />
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={actions} />
      {installOver.toast}
    </>
  );
}
