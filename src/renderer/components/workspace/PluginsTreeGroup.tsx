import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Chip, IconButton, Menu, MenuItem, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { AlertTriangle, MoreVertical, Puzzle } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { StatusPill } from '../ds/StatusPill.js';
import { DetailDrawer } from '../DetailDrawer.js';
import { TreeGroup } from './TreeGroup.js';
import { Toast, type ToastMessage } from '../Toast.js';
import {
  pluginsQueryKey, usePluginList, useRemovePlugin, useTogglePlugin, useUpdatePlugin, type PluginScope,
} from '../../hooks/use-plugins.js';
import { IpcCallError } from '../../lib/ipc.js';
import { PluginDetail } from '../../screens/plugins/PluginDetail.js';
import { PluginImportDialog } from '../../screens/plugins/PluginImportDialog.js';
import { PublishPluginDialog } from '../../screens/plugins/PublishPluginDialog.js';
import type { PluginListItemIpc, PluginRefIpc } from '../../../shared/plugin-ipc-types.js';

interface PluginsTreeGroupProps {
  /** True once inside a non-default Workspace — plugins then split into this workspace's own ('project' scope) vs Personal ones, matching how EntityTreeGroup's localScope works. Omitted at the Default workspace, where only 'personal' scope exists and nothing is filtered. */
  isProjectContext?: boolean;
  showGlobal: boolean;
}

type RowMenu = { anchorEl: HTMLElement; item: PluginListItemIpc };
type PublishState = { pluginId: string; scope: PluginScope; currentVersion?: string; hasPublishInfo: boolean };

function refShort(ref: PluginRefIpc | undefined): string | undefined {
  return ref?.value;
}

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

export function PluginsTreeGroup({ isProjectContext, showGlobal }: PluginsTreeGroupProps): React.ReactElement {
  const qc = useQueryClient();
  const personal = usePluginList('personal');
  const project = usePluginList('project', Boolean(isProjectContext));
  const toggle = useTogglePlugin();
  const update = useUpdatePlugin();
  const remove = useRemovePlugin();

  const invalidateLists = (): void => {
    void qc.invalidateQueries({ queryKey: pluginsQueryKey('personal') });
    void qc.invalidateQueries({ queryKey: pluginsQueryKey('project') });
  };

  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [publishing, setPublishing] = useState<PublishState | null>(null);
  const [selected, setSelected] = useState<PluginListItemIpc | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const localItems = isProjectContext ? (project.data ?? []) : (personal.data ?? []);
  const globalItems = isProjectContext && showGlobal ? (personal.data ?? []) : [];
  const visible = [...localItems, ...globalItems].sort((a, b) => a.id.localeCompare(b.id));
  const importScope: PluginScope = isProjectContext ? 'project' : 'personal';

  const closeRowMenu = (): void => setRowMenu(null);

  const handleRemove = (item: PluginListItemIpc): void => {
    if (!window.confirm(`Remover plugin "${item.id}"?`)) return;
    remove.mutate({ id: item.id, scope: item.scope }, { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) });
  };

  return (
    <>
      <TreeGroup
        testId="plugin"
        glyph={Puzzle}
        label="Plugins"
        count={visible.length}
        onCreate={() => setImportOpen(true)}
        createLabel="Importar plugin"
      >
        {visible.map((item) => {
          const global = isProjectContext ? item.scope === 'personal' : false;
          const ref = refShort(item.installedRef);
          return (
            <Box
              key={item.id}
              data-testid={`tree-plugin-${item.id}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.5 + 2.5, pr: 1, py: 0.5, cursor: 'pointer', opacity: !item.enabled || global ? 0.65 : 1 }}
              onClick={() => setSelected(item)}
            >
              <Icon glyph={Puzzle} size={14} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" noWrap sx={{ fontSize: '0.85rem' }}>{item.id}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                  {item.origin === 'owned' ? 'Próprio' : 'Importado'}{ref ? ` · ${ref}` : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                {!item.enabled && <Chip size="small" variant="outlined" label="Desabilitado" sx={{ height: 18, fontSize: '0.6875rem' }} />}
                {global && <StatusPill variant="idle" label="Global" testId={`plugin-global-${item.id}`} />}
                {item.drift && (
                  <Tooltip title={item.drift.details ?? `Desvio detectado: ${item.drift.kind}`}>
                    <Box component="span" data-testid={`tree-plugin-drift-${item.id}`} sx={{ display: 'inline-flex', color: 'warning.main' }}>
                      <Icon glyph={AlertTriangle} size={14} />
                    </Box>
                  </Tooltip>
                )}
                <Switch
                  size="small"
                  checked={item.enabled}
                  slotProps={{ input: { 'aria-label': `Toggle ${item.id}` } }}
                  onChange={(e) =>
                    toggle.mutate(
                      { id: item.id, scope: item.scope, enabled: e.target.checked },
                      { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) },
                    )
                  }
                />
                <IconButton
                  size="small"
                  data-testid={`tree-plugin-menu-${item.id}`}
                  aria-label={`Mais opções para ${item.id}`}
                  onClick={(e) => setRowMenu({ anchorEl: e.currentTarget, item })}
                >
                  <Icon glyph={MoreVertical} size={14} />
                </IconButton>
              </Stack>
            </Box>
          );
        })}
      </TreeGroup>

      <Menu anchorEl={rowMenu?.anchorEl ?? null} open={rowMenu !== null} onClose={closeRowMenu}>
        {rowMenu?.item.origin === 'imported' && [
          rowMenu.item.installedRef?.kind === 'branch' && (
            <MenuItem
              key="update"
              onClick={() => {
                const item = rowMenu.item;
                closeRowMenu();
                update.mutate({ id: item.id, scope: item.scope }, { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) });
              }}
            >
              Atualizar
            </MenuItem>
          ),
          <MenuItem key="remove" onClick={() => { const item = rowMenu.item; closeRowMenu(); handleRemove(item); }}>
            Remover
          </MenuItem>,
          // Reconciling drift has no backing action yet — pre-existing stub kept as-is from the old PluginList row menu.
          rowMenu.item.drift && <MenuItem key="reconcile" onClick={closeRowMenu}>Reconciliar</MenuItem>,
        ]}
        {rowMenu?.item.origin === 'owned' && [
          <MenuItem
            key="publish"
            onClick={() => {
              const item = rowMenu.item;
              closeRowMenu();
              setPublishing({
                pluginId: item.id,
                scope: item.scope,
                hasPublishInfo: Boolean(item.publishInfo),
                ...(item.publishInfo?.lastPublishedVersion ? { currentVersion: item.publishInfo.lastPublishedVersion } : {}),
              });
            }}
          >
            Publicar
          </MenuItem>,
          <MenuItem key="remove" onClick={() => { const item = rowMenu.item; closeRowMenu(); handleRemove(item); }}>
            Remover
          </MenuItem>,
          rowMenu.item.drift && <MenuItem key="reconcile" onClick={closeRowMenu}>Reconciliar</MenuItem>,
        ]}
      </Menu>

      <PluginImportDialog
        open={importOpen}
        scope={importScope}
        onClose={() => setImportOpen(false)}
        onSuccess={() => {
          setImportOpen(false);
          invalidateLists();
        }}
      />

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

      <DetailDrawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.id ?? ''}
        testId="plugin"
      >
        {selected && <PluginDetail pluginId={selected.id} scope={selected.scope} />}
      </DetailDrawer>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
