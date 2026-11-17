import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { Plug, Puzzle, Terminal, Webhook, type LucideIcon } from 'lucide-react';
import { TreeGroupRow } from './TreeGroup.js';
import { RowBadgeSlot, RowLabel, rowMuted, rowTestId } from './RowBadgeSlot.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { pluginsQueryKey, useRemovePlugin, useTogglePlugin, useUpdatePlugin, type PluginScope } from '../../hooks/use-plugins.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { ENTITY_GROUP_ICONS } from '../shell/nav.js';
import { PublishPluginDialog } from '../../screens/plugins/PublishPluginDialog.js';
import type { TreeItem } from '../../lib/customization-tree.js';
import type { PluginDetailIpc, PluginListItemIpc, PluginRefIpc } from '../../../shared/plugin-ipc-types.js';

type PublishState = { pluginId: string; scope: PluginScope; currentVersion?: string; hasPublishInfo: boolean };

const INSTALLED_BY_LABEL = { claude: 'Claude', both: 'App + Claude' } as const;

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

function pluginTooltip(item: PluginListItemIpc, ref: PluginRefIpc | undefined): string {
  const parts = [
    item.installedBy === 'claude' ? 'Instalado pelo Claude' : item.origin === 'owned' ? 'Próprio' : 'Importado',
    ...(item.version !== undefined ? [`Claude ${item.version}`] : []),
    ...(ref?.value ? [ref.value] : []),
    ...(item.enabled ? [] : ['desabilitado']),
    ...(item.drift?.details !== undefined ? [item.drift.details] : []),
  ];
  return parts.join(' · ');
}

/**
 * One plugin as a closed folder: the row toggles, and what the plugin provides lists inline underneath
 * (one level deeper). What a plugin provides is listed only here, never again in the type groups.
 */
export function PluginTreeRow({ item, depth = 1 }: { item: TreeItem; depth?: number }): React.ReactElement | null {
  const qc = useQueryClient();
  const toggle = useTogglePlugin();
  const update = useUpdatePlugin();
  const remove = useRemovePlugin();
  const [open, setOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const [publishing, setPublishing] = useState<PublishState | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const plugin = item.entity.kind === 'plugin' ? item.entity.value : undefined;
  const { data: detail } = useQuery<PluginDetailIpc>({
    queryKey: ['plugin.detail', plugin?.scope, plugin?.id],
    queryFn: () => callIpc<PluginDetailIpc>('plugin.get', { id: plugin?.id, scope: plugin?.scope }),
    enabled: open && plugin !== undefined,
  });
  if (plugin === undefined) return null;

  const closeMenu = (): void => setMenuAt(null);
  const onError = (err: unknown): void => setToast({ variant: 'error', message: errorMessage(err) });
  const handleRemove = (): void => {
    closeMenu();
    if (!window.confirm(`Remover plugin "${plugin.id}"?`)) return;
    remove.mutate({ id: plugin.id, scope: plugin.scope }, { onError });
  };
  const invalidateLists = (): void => {
    void qc.invalidateQueries({ queryKey: pluginsQueryKey('personal') });
    void qc.invalidateQueries({ queryKey: pluginsQueryKey('project') });
  };

  const artifacts = detail?.manifest?.artifacts;
  const provided: Array<{ key: string; glyph: LucideIcon; label: string }> = artifacts
    ? [
        ...artifacts.skills.map((n) => ({ key: `skill:${n}`, glyph: ENTITY_GROUP_ICONS.skill, label: n })),
        ...artifacts.agents.map((n) => ({ key: `agent:${n}`, glyph: ENTITY_GROUP_ICONS.agent, label: n })),
        ...artifacts.commands.map((n) => ({ key: `command:${n}`, glyph: Terminal, label: n })),
        ...(artifacts.hooks > 0 ? [{ key: 'hooks', glyph: Webhook, label: `Hooks · ${artifacts.hooks}` }] : []),
        ...(artifacts.mcp ? [{ key: 'mcp', glyph: Plug, label: 'MCP' }] : []),
      ]
    : [];

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        glyph={Puzzle}
        depth={depth}
        mono
        chevron={open ? 'expanded' : 'collapsed'}
        muted={rowMuted(item)}
        onClick={() => setOpen((v) => !v)}
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
              <Typography component="span" data-testid={`tree-plugin-installed-by-${plugin.id}`} noWrap sx={{ flexShrink: 0, fontSize: '0.6875rem', color: 'text.disabled' }}>
                {INSTALLED_BY_LABEL[plugin.installedBy]}
              </Typography>
            )}
            <RowBadgeSlot item={item} />
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
      {open &&
        provided.map((p) => (
          <TreeGroupRow key={p.key} testId={`tree-plugin-${plugin.id}-${p.key}`} glyph={p.glyph} depth={depth + 1} mono muted primary={p.label} />
        ))}

      <Menu anchorReference="anchorPosition" {...(menuAt ? { anchorPosition: menuAt } : {})} open={menuAt !== null} onClose={closeMenu}>
        <MenuItem
          data-testid={`tree-plugin-toggle-${plugin.id}`}
          onClick={() => {
            closeMenu();
            toggle.mutate({ id: plugin.id, scope: plugin.scope, enabled: !plugin.enabled }, { onError });
          }}
        >
          {plugin.enabled ? 'Desativar' : 'Ativar'}
        </MenuItem>
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
        {plugin.origin === 'owned' && (
          <MenuItem
            onClick={() => {
              closeMenu();
              setPublishing({
                pluginId: plugin.id,
                scope: plugin.scope,
                hasPublishInfo: Boolean(plugin.publishInfo),
                ...(plugin.publishInfo?.lastPublishedVersion ? { currentVersion: plugin.publishInfo.lastPublishedVersion } : {}),
              });
            }}
          >
            Publicar
          </MenuItem>
        )}
        <MenuItem onClick={handleRemove}>Remover</MenuItem>
        {/* Reconciling drift has no backing action yet — pre-existing stub kept as-is from the old PluginList row menu. */}
        {plugin.drift && <MenuItem onClick={closeMenu}>Reconciliar</MenuItem>}
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
