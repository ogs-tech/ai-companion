import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { Menu, MenuItem, Tooltip } from '@mui/material';
import { Plug, Puzzle, Terminal, Webhook, type LucideIcon } from 'lucide-react';
import type { HarnessId } from '../../../shared/harness.js';
import { ChannelWarning } from '../ds/ChannelWarning.js';
import { useEntityHealth } from '../../hooks/use-entity-health.js';
import { countProblems } from '../../lib/entity-health.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { Toast, type ToastMessage } from '../Toast.js';
import {
  pluginsQueryKey, usePluginList, useRemovePlugin, useTogglePlugin, useUpdatePlugin, type PluginScope,
} from '../../hooks/use-plugins.js';
import { IpcCallError } from '../../lib/ipc.js';
import { matchesOrigin, matchesQuery, useReportCount, type OriginSegment } from '../../lib/control-panel-filter.js';
import { ENTITY_GROUP_ICONS } from '../shell/nav.js';
import { callIpc } from '../../lib/ipc.js';
import { PluginImportDialog } from '../../screens/plugins/PluginImportDialog.js';
import { PublishPluginDialog } from '../../screens/plugins/PublishPluginDialog.js';
import type { PluginDetailIpc, PluginListItemIpc, PluginRefIpc } from '../../../shared/plugin-ipc-types.js';

interface PluginsTreeGroupProps {
  /** True while a workspace is open — plugins then split into this workspace's own (Claude Code's 'project' plugin scope) vs Personal ones, matching how EntityTreeGroup's localScope works. Omitted at Início, where only 'personal' scope exists and nothing is filtered. */
  isProjectContext?: boolean;
  showGlobal: boolean;
  /** Lists only the personal-scope plugins while a workspace is open — the read-only "Do Global" section. */
  onlyGlobal?: boolean;
  /** Rows only, no group header — see `TreeGroup`'s `flat`. */
  flat?: boolean;
  /** Row indent level — see `TreeGroup`'s `depth`. */
  depth?: number;
  /** Keeps only plugins whose id contains this text. */
  query?: string;
  /** Owned plugins count as the user's own; imported ones as plugin-provided. Defaults to both. */
  origin?: OriginSegment;
  /** Reports the number of rows this list renders. */
  onCount?: (count: number) => void;
  /** Reports how many of the rows have a problem in some channel. */
  onProblems?: (count: number) => void;
  /** Starts expanded — see `TreeGroup`'s `defaultExpanded`. */
  defaultExpanded?: boolean;
  /** Renders nothing and only reports the count, so it keeps flowing while the rows' group is collapsed or hidden. */
  countOnly?: boolean;
}

type RowMenu = { anchorPosition: { top: number; left: number }; item: PluginListItemIpc };

const pluginUrn = (id: string): string => `urn:plugin:${id}`;
type PublishState = { pluginId: string; scope: PluginScope; currentVersion?: string; hasPublishInfo: boolean };

function refShort(ref: PluginRefIpc | undefined): string | undefined {
  return ref?.value;
}

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

export function PluginsTreeGroup({ isProjectContext, showGlobal, onlyGlobal = false, flat = false, depth = 0, query = '', origin = 'all', onCount, onProblems, defaultExpanded = false, countOnly = false }: PluginsTreeGroupProps): React.ReactElement {
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
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const localItems = onlyGlobal ? [] : isProjectContext ? (project.data ?? []) : (personal.data ?? []);
  const globalItems = isProjectContext && (showGlobal || onlyGlobal) ? (personal.data ?? []) : [];
  const visible = [...localItems, ...globalItems]
    .filter((p) => matchesOrigin(origin, p.origin !== 'owned'))
    .filter((p) => matchesQuery(query, p.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const health = useEntityHealth();
  const problems = countProblems(health, visible.map((p) => pluginUrn(p.id)));
  useReportCount(visible.length, onCount);
  useReportCount(problems, onProblems);
  const importScope: PluginScope = isProjectContext ? 'project' : 'personal';

  if (countOnly) return <></>;

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
        problems={problems}
        depth={depth}
        defaultExpanded={defaultExpanded}
        flat={flat}
        onCreate={() => setImportOpen(true)}
        createLabel="Importar plugin"
      >
        {visible.map((item) => {
          const global = isProjectContext ? item.scope === 'personal' : false;
          const ref = refShort(item.installedRef);
          return (
            <PluginFolder
              key={item.id}
              item={item}
              depth={depth}
              muted={!item.enabled || global}
              tooltip={`${item.origin === 'owned' ? 'Próprio' : 'Importado'}${ref ? ` · ${ref}` : ''}${item.enabled ? '' : ' · desabilitado'}`}
              channels={health.get(pluginUrn(item.id)) ?? []}
              onContextMenu={(e) => {
                e.preventDefault();
                setRowMenu({ anchorPosition: { top: e.clientY, left: e.clientX }, item });
              }}
            />
          );
        })}
      </TreeGroup>

      <Menu anchorReference="anchorPosition" {...(rowMenu ? { anchorPosition: rowMenu.anchorPosition } : {})} open={rowMenu !== null} onClose={closeRowMenu}>
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

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

interface PluginFolderProps {
  item: PluginListItemIpc;
  depth: number;
  muted: boolean;
  tooltip: string;
  channels: readonly HarnessId[];
  onContextMenu: (e: React.MouseEvent) => void;
}

/** A plugin as a droplist: the row toggles, and what the plugin provides lists inline underneath. */
function PluginFolder({ item, depth, muted, tooltip, channels, onContextMenu }: PluginFolderProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { data: detail } = useQuery<PluginDetailIpc>({
    queryKey: ['plugin.detail', item.scope, item.id],
    queryFn: () => callIpc<PluginDetailIpc>('plugin.get', { id: item.id, scope: item.scope }),
    enabled: open,
  });
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
        testId={`tree-plugin-${item.id}`}
        glyph={Puzzle}
        depth={depth}
        mono
        chevron={open ? 'expanded' : 'collapsed'}
        muted={muted}
        onClick={() => setOpen((v) => !v)}
        primary={<Tooltip title={tooltip}><span>{item.id}</span></Tooltip>}
        badge={<ChannelWarning urn={pluginUrn(item.id)} channels={channels} />}
        onContextMenu={onContextMenu}
      />
      {open &&
        provided.map((p) => (
          <TreeGroupRow key={p.key} testId={`tree-plugin-${item.id}-${p.key}`} glyph={p.glyph} depth={depth + 1} mono muted primary={p.label} />
        ))}
    </>
  );
}
