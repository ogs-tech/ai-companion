import { useState } from 'react';
import { Stack } from '@mui/material';
import { Eye, Settings2, SquareTerminal, Trash2 } from 'lucide-react';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import { SessionsUsingBadge } from './SessionsUsingBadge.js';
import { TreeGroupRow } from './TreeGroup.js';
import { RowBadgeSlot, RowLabel, rowMuted, rowTestId } from './RowBadgeSlot.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { ENTITY_GROUP_ICONS } from '../shell/nav.js';
import { useInvalidateCustomization } from '../../hooks/use-customization-list.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { Toast, type ToastMessage } from '../Toast.js';
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
}

interface EntityTreeRowProps {
  item: TreeItem;
  handlers: EntityRowHandlers;
  depth?: number;
}

/** One skill or agent of the tree. A Global one is read-only here: it opens with "Editar no Início", and offers no delete. */
export function EntityTreeRow({ item, handlers, depth = 1 }: EntityTreeRowProps): React.ReactElement | null {
  const invalidate = useInvalidateCustomization();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Skill | Agent>();
  const { entity } = item;
  if (entity.kind !== 'skill' && entity.kind !== 'agent') return null;
  const { kind, value } = entity;
  const inherited = item.origin === 'global';

  const handleDelete = async (target: Skill | Agent): Promise<void> => {
    if (!window.confirm(`Remover ${target.name}?`)) return;
    try {
      await callIpc(`${kind}.delete`, { id: target.name, removeSymlinks: true });
      await invalidate(kind);
      setToast({ variant: 'success', message: `${target.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
    }
  };

  const target = rowMenu.state?.target;
  const actions: RowContextMenuAction[] = target
    ? [
        { key: 'preview', label: 'Preview', glyph: Eye, onSelect: () => handlers.onPreview?.(target) },
        ...(inherited ? [] : [{ key: 'properties', label: 'Properties', glyph: Settings2, onSelect: () => handlers.onProperties?.(kind, target) }]),
        { key: 'new-action', label: 'New Action', glyph: SquareTerminal, onSelect: () => handlers.onNewAction?.(kind, target) },
        ...(!inherited && target.source.kind === 'workspace'
          ? [{ key: 'delete', label: 'Excluir', glyph: Trash2, danger: true, onSelect: () => void handleDelete(target) }]
          : []),
      ]
    : [];

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        glyph={ENTITY_GROUP_ICONS[kind]}
        primary={<RowLabel item={item} />}
        mono
        depth={depth}
        muted={rowMuted(item)}
        onClick={() => (inherited ? handlers.onOpenInherited(value, kind) : handlers.onEdit(kind, value, false))}
        onContextMenu={(e) => rowMenu.openMenu(e, value)}
        badge={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <SessionsUsingBadge usage={{ kind, name: value.name }} testId={`${rowTestId(item)}-using`} />
            <SessionStatusBadge anchor={{ kind: 'entity', urn: value.urn }} />
            <RowBadgeSlot item={item} />
          </Stack>
        }
      />
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={actions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
