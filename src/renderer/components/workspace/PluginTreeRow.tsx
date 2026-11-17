import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { Puzzle } from 'lucide-react';
import { TreeGroupRow } from './TreeGroup.js';
import { RowBadgeSlot, RowLabel, rowMuted, rowTestId } from './RowBadgeSlot.js';
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
import type { TreeItem } from '../../lib/customization-tree.js';
import type { PluginListItemIpc, PluginRefIpc } from '../../../shared/plugin-ipc-types.js';
import { invalidateHealth } from '../../hooks/use-health-report.js';
import { useRequestDelete } from '../../hooks/use-undoable-delete.js';

type PublishState = {
  pluginId: string;
  scope: PluginScope;
  currentVersion?: string;
  hasPublishInfo: boolean;
};

const INSTALLED_BY_LABEL = { claude: 'Claude', both: 'App + Claude' } as const;

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

function pluginTooltip(item: PluginListItemIpc, ref: PluginRefIpc | undefined): string {
  const parts = [
    item.installedBy === 'claude'
      ? 'Instalado pelo Claude'
      : item.origin === 'owned'
        ? 'Próprio'
        : 'Importado',
    ...(item.version !== undefined ? [`Claude ${item.version}`] : []),
    ...(ref?.value ? [ref.value] : []),
    ...(item.enabled ? [] : ['desabilitado']),
    ...(item.drift?.details !== undefined ? [item.drift.details] : []),
  ];
  return parts.join(' · ');
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
 * One plugin as a closed folder with `ativo`/`desativado`: clicking it lists what it ships underneath, one level
 * deeper — those items are listed only here, never in the kind groups. Menu: Atualizar · Ativar/Desativar · (Publicar) · Remover.
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

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        glyph={Puzzle}
        depth={depth}
        mono
        muted={rowMuted(item)}
        {...(expandable
          ? {
              chevron: open ? ('expanded' as const) : ('collapsed' as const),
              onClick: () => setUserOpen((v) => !v),
            }
          : {})}
        primary={
          <Tooltip title={pluginTooltip(plugin, plugin.installedRef)}>
            <span>
              <RowLabel item={item} />
            </span>
          </Tooltip>
        }
        badge={
          <>
            {plugin.installedBy !== undefined && (
              <Typography
                component="span"
                data-testid={`tree-plugin-installed-by-${plugin.id}`}
                noWrap
                sx={{ flexShrink: 0, fontSize: '0.6875rem', color: 'text.disabled' }}
              >
                {INSTALLED_BY_LABEL[plugin.installedBy]}
              </Typography>
            )}
            <Typography
              component="span"
              data-testid={`tree-plugin-state-${plugin.id}`}
              noWrap
              sx={{ flexShrink: 0, fontSize: '0.6875rem', color: 'text.disabled' }}
            >
              {plugin.enabled ? 'ativo' : 'desativado'}
            </Typography>
            {/* Errors of what it provides roll up here; "desativado" is already said above. */}
            {plugin.enabled && <RowBadgeSlot item={item} />}
          </>
        }
        // A plugin only Claude installed is read-only here: the app has no registry entry to act on.
        {...(plugin.installedBy === 'claude'
          ? {}
          : {
              onContextMenu: (e: React.MouseEvent) => {
                e.preventDefault();
                setMenuAt({ top: e.clientY, left: e.clientX });
              },
            })}
      />
      {open && renderChild && children.map((child) => renderChild(child, depth + 1))}

      <Menu
        anchorReference="anchorPosition"
        {...(menuAt ? { anchorPosition: menuAt } : {})}
        open={menuAt !== null}
        onClose={closeMenu}
      >
        {plugin.origin === 'imported' && plugin.installedRef?.kind === 'branch' && (
          <MenuItem
            onClick={() => {
              closeMenu();
              update.mutate({ id: plugin.id, scope: plugin.scope }, { onError });
            }}
          >
            Atualizar
          </MenuItem>
        )}
        <MenuItem
          data-testid={`tree-plugin-toggle-${plugin.id}`}
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
        <MenuItem data-testid={`tree-plugin-remove-${plugin.id}`} onClick={handleRemove}>
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
