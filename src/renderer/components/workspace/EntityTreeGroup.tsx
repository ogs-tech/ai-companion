import { useState } from 'react';
import { Box, Stack, Tooltip } from '@mui/material';
import { Eye, Settings2, SquareTerminal, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { PluginOriginBadge } from '../PluginOriginBadge.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { ENTITY_GROUP_ICONS, ENTITY_ACCENT_COLOR } from '../shell/nav.js';
import { useCustomizationList, useInvalidateCustomization } from '../../hooks/use-customization-list.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { matchesQuery, useReportCount } from '../../lib/control-panel-filter.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { Toast, type ToastMessage } from '../Toast.js';
import type { Agent, Entity, Skill } from '../../../shared/entity.js';

interface LocalScope {
  scope: 'workspace';
  scopeId: string;
}

interface EntityTreeGroupProps {
  kind: 'skill' | 'agent';
  label: string;
  /** Omitted at Início — there, nothing is "more global" than this, so every item shows unfiltered. */
  localScope?: LocalScope;
  /**
   * Lists the entities that do NOT belong to `localScope` instead — the
   * workspace's read-only "Do Global" view: no create, no delete,
   * and `onEdit` is expected to open a read-only tab.
   */
  inherited?: boolean;
  /** See `TreeGroup`'s own `depth`. */
  depth?: number;
  /** Rows only, no group header — see `TreeGroup`'s `flat`. */
  flat?: boolean;
  /** Keeps only entities whose name or description contains this text. */
  query?: string;
  /** Reports the number of rows this list renders. */
  onCount?: (count: number) => void;
  /** Opens a create/edit tab for this entity in the parent screen's Workbench canvas — this group only ever lists rows, it never renders the editor itself. */
  onEdit: (kind: 'skill' | 'agent', entity: Skill | Agent, isCreate: boolean) => void;
  /** Right-click on a row → "Preview" — opens a read-only rendered-Markdown tab instead of the editing tab `onEdit` opens. */
  onPreview?: (entity: Skill | Agent) => void;
  /** Right-click on a row → "Properties" — opens (or focuses) the entity's editing tab and requests its Properties modal. */
  onProperties?: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
  /** Right-click on a row → "New Action" — opens a brand-new session with a draft first message referencing this entity. */
  onNewAction?: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
}

function isLocal(entity: Entity, localScope: LocalScope | undefined): boolean {
  if (!localScope) return true;
  return entity.scopes[0] === localScope.scope && entity.scopeId === localScope.scopeId;
}

/** A blank entity of `kind`, pre-scoped to the open workspace when there is one. */
export function seedNewEntity(kind: 'skill' | 'agent', localScope: LocalScope | undefined): Skill | Agent {
  const blank = blankCustomization(kind) as Skill | Agent;
  return localScope ? ({ ...blank, scopes: [localScope.scope], scopeId: localScope.scopeId } as Skill | Agent) : blank;
}

export function EntityTreeGroup({ kind, label, localScope, inherited = false, depth = 0, flat = false, query = '', onCount, onEdit, onPreview, onProperties, onNewAction }: EntityTreeGroupProps): React.ReactElement {
  const { data } = useCustomizationList(kind, `${kind}.list`);
  const invalidate = useInvalidateCustomization();
  const items = data ?? [];

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Skill | Agent>();
  const rowMenuTarget = rowMenu.state?.target;
  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget
    ? [
        { key: 'preview', label: 'Preview', glyph: Eye, onSelect: () => onPreview?.(rowMenuTarget) },
        ...(inherited
          ? []
          : [{ key: 'properties', label: 'Properties', glyph: Settings2, onSelect: () => onProperties?.(kind, rowMenuTarget) }]),
        { key: 'new-action', label: 'New Action', glyph: SquareTerminal, onSelect: () => onNewAction?.(kind, rowMenuTarget) },
      ]
    : [];

  const visible = items
    .filter((item) => (inherited ? !isLocal(item, localScope) : isLocal(item, localScope)))
    .filter((item) => matchesQuery(query, item.name, item.description))
    .sort((a, b) => a.name.localeCompare(b.name));
  const groupTestId = inherited ? `inherited-${kind}` : kind;

  useReportCount(visible.length, onCount);

  const startCreate = (): void => onEdit(kind, seedNewEntity(kind, localScope), true);

  const handleDelete = async (item: Entity): Promise<void> => {
    if (!window.confirm(`Remover ${item.name}?`)) return;
    try {
      await callIpc(`${kind}.delete`, { id: item.name, removeSymlinks: true });
      await invalidate(kind);
      setToast({ variant: 'success', message: `${item.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
    }
  };

  return (
    <>
      <TreeGroup
        testId={groupTestId}
        glyph={ENTITY_GROUP_ICONS[kind]}
        label={label}
        count={visible.length}
        depth={depth}
        flat={flat}
        {...(inherited ? {} : { onCreate: startCreate, createLabel: `Novo ${kind === 'skill' ? 'skill' : 'agent'}` })}
      >
        {visible.map((item) => {
          return (
            <TreeGroupRow
              key={item.urn}
              testId={`tree-${groupTestId}-${item.name}`}
              glyph={ENTITY_GROUP_ICONS[kind]}
              primary={item.name}
              mono
              depth={depth}
              muted={inherited}
              accentColor={ENTITY_ACCENT_COLOR[kind]}
              onClick={() => onEdit(kind, item as Skill | Agent, false)}
              onContextMenu={(e) => rowMenu.openMenu(e, item as Skill | Agent)}
              badge={
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <SessionStatusBadge anchor={{ kind: 'entity', urn: item.urn }} />
                  {item.source.kind === 'plugin' ? (
                    <PluginOriginBadge pluginId={item.source.pluginId} provenance={item.source.provenance} />
                  ) : undefined}
                </Stack>
              }
              // Row click already opens this same item in the editor tab (view
              // mode when read-only, edit mode otherwise) — a separate "Editar"
              // action here would just duplicate it, so only Excluir survives
              // as a hover action.
              actions={
                !inherited && item.source.kind === 'workspace' ? (
                  <Tooltip title="Excluir">
                    <Box
                      component="span"
                      role="button"
                      tabIndex={0}
                      aria-label={`Excluir ${item.name}`}
                      data-testid={`tree-${kind}-delete-${item.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(item);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        if (e.key === ' ') e.preventDefault();
                        e.stopPropagation();
                        void handleDelete(item);
                      }}
                      sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                    >
                      <Icon glyph={Trash2} size={14} />
                    </Box>
                  </Tooltip>
                ) : undefined
              }
            />
          );
        })}
      </TreeGroup>
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
