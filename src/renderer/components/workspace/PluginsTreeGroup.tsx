import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Menu, MenuItem, Tooltip } from '@mui/material';
import { AlertTriangle, Puzzle } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { OriginMeta } from './OriginMeta.js';
import { DetailDrawer } from '../DetailDrawer.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { RowMenuButton } from './RowMenuButton.js';
import { ENTITY_ACCENT_COLOR } from '../shell/nav.js';
import { Toast, type ToastMessage } from '../Toast.js';
import {
  pluginsQueryKey, usePluginList, useRemovePlugin, useTogglePlugin, useUpdatePlugin, type PluginScope,
} from '../../hooks/use-plugins.js';
import { IpcCallError } from '../../lib/ipc.js';
import { matchesOrigin, matchesQuery, useReportCount, type OriginSegment } from '../../lib/control-panel-filter.js';
import { PluginDetail } from '../../screens/plugins/PluginDetail.js';
import { PluginImportDialog } from '../../screens/plugins/PluginImportDialog.js';
import { PublishPluginDialog } from '../../screens/plugins/PublishPluginDialog.js';
import type { PluginListItemIpc, PluginRefIpc } from '../../../shared/plugin-ipc-types.js';

interface PluginsTreeGroupProps {
  /** True while a workspace is open — plugins then split into this workspace's own (Claude Code's 'project' plugin scope) vs Personal ones, matching how EntityTreeGroup's localScope works. Omitted at Início, where only 'personal' scope exists and nothing is filtered. */
  isProjectContext?: boolean;
  showGlobal: boolean;
  /** Lists only the personal-scope plugins while a workspace is open — the read-only "Do Global" section. */
  onlyGlobal?: boolean;
  /** Rows only, no group header — see `TreeGroup`'s `flat`. */
  flat?: boolean;
  /** Keeps only plugins whose id contains this text. */
  query?: string;
  /** Owned plugins count as the user's own; imported ones as plugin-provided. Defaults to both. */
  origin?: OriginSegment;
  /** Reports the number of rows this list renders. */
  onCount?: (count: number) => void;
}

type RowMenu = { anchorEl: HTMLElement; item: PluginListItemIpc };
type PublishState = { pluginId: string; scope: PluginScope; currentVersion?: string; hasPublishInfo: boolean };

function refShort(ref: PluginRefIpc | undefined): string | undefined {
  return ref?.value;
}

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

export function PluginsTreeGroup({ isProjectContext, showGlobal, onlyGlobal = false, flat = false, query = '', origin = 'all', onCount }: PluginsTreeGroupProps): React.ReactElement {
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

  const localItems = onlyGlobal ? [] : isProjectContext ? (project.data ?? []) : (personal.data ?? []);
  const globalItems = isProjectContext && (showGlobal || onlyGlobal) ? (personal.data ?? []) : [];
  const visible = [...localItems, ...globalItems]
    .filter((p) => matchesOrigin(origin, p.origin !== 'owned'))
    .filter((p) => matchesQuery(query, p.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  useReportCount(visible.length, onCount);
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
        flat={flat}
        onCreate={() => setImportOpen(true)}
        createLabel="Importar plugin"
      >
        {visible.map((item) => {
          const global = isProjectContext ? item.scope === 'personal' : false;
          const ref = refShort(item.installedRef);
          return (
            <TreeGroupRow
              key={item.id}
              testId={`tree-plugin-${item.id}`}
              glyph={Puzzle}
              mono
              accentColor={ENTITY_ACCENT_COLOR.plugin}
              muted={!item.enabled || global}
              onClick={() => setSelected(item)}
              primary={
                <Tooltip title={`${item.origin === 'owned' ? 'Próprio' : 'Importado'}${ref ? ` · ${ref}` : ''}${item.enabled ? '' : ' · desabilitado'}`}>
                  <span>{item.id}</span>
                </Tooltip>
              }
              badge={
                <>
                  {item.drift && (
                    <Tooltip title={item.drift.details ?? `Desvio detectado: ${item.drift.kind}`}>
                      <Box component="span" data-testid={`tree-plugin-drift-${item.id}`} sx={{ display: 'inline-flex', color: 'warning.main' }}>
                        <Icon glyph={AlertTriangle} size={14} />
                      </Box>
                    </Tooltip>
                  )}
                  {global && <OriginMeta inherited />}
                </>
              }
              actions={
                <RowMenuButton
                  testId={`tree-plugin-menu-${item.id}`}
                  label={`Mais opções para ${item.id}`}
                  onOpen={(e) => {
                    e.stopPropagation();
                    setRowMenu({ anchorEl: e.currentTarget as HTMLElement, item });
                  }}
                />
              }
            />
          );
        })}
      </TreeGroup>

      <Menu anchorEl={rowMenu?.anchorEl ?? null} open={rowMenu !== null} onClose={closeRowMenu}>
        {rowMenu && (
          <MenuItem
            key="toggle"
            data-testid={`tree-plugin-toggle-${rowMenu.item.id}`}
            onClick={() => {
              const item = rowMenu.item;
              closeRowMenu();
              toggle.mutate(
                { id: item.id, scope: item.scope, enabled: !item.enabled },
                { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) },
              );
            }}
          >
            {rowMenu.item.enabled ? 'Desativar' : 'Ativar'}
          </MenuItem>
        )}
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
