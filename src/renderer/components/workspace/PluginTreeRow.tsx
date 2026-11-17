import { Fragment, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Button, Menu, MenuItem, Typography } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { TreeGroupRow } from './TreeGroup.js';
import { RowLabel, rowMuted, rowTestId } from './RowBadgeSlot.js';
import { ChannelWarning } from '../ds/ChannelWarning.js';
import { Toast, type ToastMessage } from '../Toast.js';
import {
  pluginsQueryKey,
  useRemovePlugin,
  useTogglePlugin,
  useUpdatePlugin,
  type PluginScope,
} from '../../hooks/use-plugins.js';
import { IpcCallError } from '../../lib/ipc.js';
import { PublishPluginDialog } from '../../screens/plugins/PublishPluginDialog.js';
import { channelsWith, rowBadge, type TreeItem } from '../../lib/customization-tree.js';
import { kindSpec } from '../../../shared/customization-kind.js';
import type { PluginListItemIpc } from '../../../shared/plugin-ipc-types.js';
import { invalidateHealth } from '../../hooks/use-health-report.js';
import { useRequestDelete } from '../../hooks/use-undoable-delete.js';

type PublishState = {
  pluginId: string;
  scope: PluginScope;
  currentVersion?: string;
  hasPublishInfo: boolean;
};

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

/** The kinds a plugin can ship, in the tree's group order: its items are listed under one sub-header per kind. */
const SHIPPED_KINDS = ['skill', 'agent', 'mcp', 'hook'] as const;
type ShippedKind = (typeof SHIPPED_KINDS)[number];

function groupByKind(items: readonly TreeItem[]): Array<{ kind: ShippedKind; items: TreeItem[] }> {
  return SHIPPED_KINDS.map((kind) => ({
    kind,
    items: items.filter((i) => i.entity.kind === kind),
  })).filter((g) => g.items.length > 0);
}

/** Only a plugin imported from a branch can be pulled again; one only Claude installed has no registry entry. */
function canUpdate(plugin: PluginListItemIpc): boolean {
  return (
    plugin.origin === 'imported' &&
    plugin.installedRef?.kind === 'branch' &&
    plugin.installedBy !== 'claude'
  );
}

interface PluginTreeRowProps {
  item: TreeItem;
  depth?: number;
  /** Renders one item the plugin ships (a skill, agent, MCP server or hook row) one level deeper. */
  renderChild?: (child: TreeItem, depth: number) => React.ReactNode;
  /** Keeps the plugin open regardless of the user's choice (an active search or chip shows its matches). */
  forceOpen?: boolean;
}

/**
 * One plugin as a closed folder: name and version, then only what needs attention — `⚠ N` when something it ships
 * fails, and an `Atualizar` button (the one action shown on the row) when it can be pulled again. A disabled plugin
 * reads muted. Clicking it lists what it ships underneath, one collapsible sub-header per kind (closed until clicked, open while a
 * search or chip forces the plugin open) — those items are listed only here,
 * never in the kind groups. Menu: Ativar/Desativar · (Publicar) · Remover; read-only, with the reason, for a plugin
 * only Claude installed.
 */
export function PluginTreeRow({
  item,
  depth = 1,
  renderChild,
  forceOpen = false,
}: PluginTreeRowProps): React.ReactElement | null {
  const qc = useQueryClient();
  const toggle = useTogglePlugin();
  const update = useUpdatePlugin();
  const remove = useRemovePlugin();
  const requestDelete = useRequestDelete();
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const [publishing, setPublishing] = useState<PublishState | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [openKinds, setOpenKinds] = useState<ReadonlySet<ShippedKind>>(new Set());
  if (item.entity.kind !== 'plugin') return null;
  const plugin = item.entity.value;
  const children = item.entity.items;
  const expandable = children.length > 0;
  const open = expandable && (forceOpen || userOpen);

  const closeMenu = (): void => setMenuAt(null);
  const onError = (err: unknown): void =>
    setToast({ variant: 'error', message: errorMessage(err) });
  const handleRemove = (): void => {
    closeMenu();
    requestDelete({
      key: item.urn,
      message: `Plugin "${plugin.id}" removido`,
      commit: () => remove.mutateAsync({ id: plugin.id, scope: plugin.scope }),
    });
  };
  const invalidateLists = (): void => {
    void qc.invalidateQueries({ queryKey: pluginsQueryKey('personal') });
    void qc.invalidateQueries({ queryKey: pluginsQueryKey('project') });
    void invalidateHealth(qc);
  };

  const handleUpdate = (e: React.MouseEvent): void => {
    e.stopPropagation();
    update.mutate(
      { id: plugin.id, scope: plugin.scope },
      {
        onSuccess: () =>
          setToast({ variant: 'success', message: `Plugin "${plugin.id}" atualizado` }),
        onError,
      },
    );
  };
  const claudeOnly = plugin.installedBy === 'claude';
  const toggleKind = (kind: ShippedKind): void =>
    setOpenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        depth={depth}
        muted={rowMuted(item)}
        {...(expandable
          ? {
              chevron: open ? ('expanded' as const) : ('collapsed' as const),
              onClick: () => setUserOpen((v) => !v),
            }
          : // Nothing to list: keep the chevron's column so it lines up with the plugins that expand.
            { chevron: 'spacer' as const })}
        primary={
          <>
            <RowLabel item={item} />
            {plugin.version !== undefined && (
              <Box
                component="span"
                data-testid={`tree-plugin-version-${plugin.id}`}
                sx={{ color: 'text.secondary', ml: 0.75 }}
              >
                {plugin.version}
              </Box>
            )}
          </>
        }
        badge={
          <>
            {/* Errors of what it provides roll up here; a disabled plugin has none to report. */}
            {plugin.enabled && rowBadge(item) === 'error' && (
              <ChannelWarning urn={item.urn} channels={channelsWith(item, 'error')} />
            )}
            {canUpdate(plugin) && (
              <Button
                size="small"
                data-testid={`tree-plugin-update-${plugin.id}`}
                disabled={update.isPending}
                onClick={handleUpdate}
                onContextMenu={(e) => e.stopPropagation()}
                startIcon={<RefreshCw size={11} />}
                sx={{
                  flexShrink: 0,
                  minWidth: 0,
                  height: 18,
                  px: 0.5,
                  fontSize: '0.75rem',
                  fontWeight: 400,
                  textTransform: 'none',
                  '& .MuiButton-startIcon': { mr: 0.5, ml: 0 },
                }}
              >
                {update.isPending ? 'Atualizando…' : 'Atualizar'}
              </Button>
            )}
          </>
        }
        onContextMenu={(e: React.MouseEvent) => {
          e.preventDefault();
          // The hover `⋯` opens this too; its click must not also toggle the row.
          e.stopPropagation();
          setMenuAt({ top: e.clientY, left: e.clientX });
        }}
      />
      {open &&
        renderChild &&
        groupByKind(children).map((group) => {
          const kindOpen = forceOpen || openKinds.has(group.kind);
          return (
            <Fragment key={group.kind}>
              <TreeGroupRow
                testId={`tree-plugin-kind-${plugin.id}-${group.kind}`}
                depth={depth + 1}
                heading
                chevron={kindOpen ? 'expanded' : 'collapsed'}
                onClick={() => toggleKind(group.kind)}
                primary={kindSpec(group.kind).label}
                badge={
                  <Typography
                    component="span"
                    sx={{ flexShrink: 0, fontSize: '0.75rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {group.items.length}
                  </Typography>
                }
              />
              {kindOpen && group.items.map((child) => renderChild(child, depth + 2))}
            </Fragment>
          );
        })}

      <Menu
        anchorReference="anchorPosition"
        {...(menuAt ? { anchorPosition: menuAt } : {})}
        open={menuAt !== null}
        onClose={closeMenu}
      >
        {claudeOnly && (
          <MenuItem
            disabled
            data-testid={`tree-plugin-claude-note-${plugin.id}`}
            sx={{ fontSize: '0.75rem', whiteSpace: 'normal', maxWidth: 240 }}
          >
            Instalado pelo Claude Code. Gerencie com /plugin.
          </MenuItem>
        )}
        <MenuItem
          data-testid={`tree-plugin-toggle-${plugin.id}`}
          disabled={claudeOnly}
          onClick={() => {
            closeMenu();
            toggle.mutate(
              { id: plugin.id, scope: plugin.scope, enabled: !plugin.enabled },
              { onError },
            );
          }}
        >
          {plugin.enabled ? 'Desativar' : 'Ativar'}
        </MenuItem>
        {plugin.origin === 'owned' && (
          <MenuItem
            onClick={() => {
              closeMenu();
              setPublishing({
                pluginId: plugin.id,
                scope: plugin.scope,
                hasPublishInfo: Boolean(plugin.publishInfo),
                ...(plugin.publishInfo?.lastPublishedVersion
                  ? { currentVersion: plugin.publishInfo.lastPublishedVersion }
                  : {}),
              });
            }}
          >
            Publicar
          </MenuItem>
        )}
        <MenuItem
          data-testid={`tree-plugin-remove-${plugin.id}`}
          disabled={claudeOnly}
          onClick={handleRemove}
        >
          Remover
        </MenuItem>
      </Menu>

      {publishing && (
        <PublishPluginDialog
          open
          pluginId={publishing.pluginId}
          scope={publishing.scope}
          hasPublishInfo={publishing.hasPublishInfo}
          currentVersion={publishing.currentVersion}
          onClose={() => setPublishing(null)}
          onSuccess={() => {
            setPublishing(null);
            invalidateLists();
          }}
        />
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
