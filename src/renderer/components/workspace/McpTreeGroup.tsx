import { useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { Download, KeyRound, Pencil, Plug, Power, Trash2 } from 'lucide-react';
import { OriginMeta } from './OriginMeta.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { OriginGroups, type OriginView } from './OriginGroups.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { RowMenuButton } from './RowMenuButton.js';
import { ENTITY_ACCENT_COLOR } from '../shell/nav.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useMcpList } from '../../hooks/use-mcp-list.js';
import { useImportDetected } from '../../hooks/use-detected.js';
import { HARNESS_LABEL } from './DetectedTreeGroup.js';
import { useDeleteMcp, useSetMcpEnabled, useAuthenticateMcp } from '../../hooks/use-mcp-mutations.js';
import { IpcCallError } from '../../lib/ipc.js';
import { matchesOrigin, matchesQuery, useReportCount, type OriginSegment } from '../../lib/control-panel-filter.js';
import { McpEditorDialog } from '../../screens/mcps/McpEditorDialog.js';
import { needsAuth, type McpHealthState, type McpServer } from '../../../shared/mcp.js';

const HEALTH_DOT_COLOR: Record<McpHealthState, string> = {
  ok: 'success.main', warning: 'warning.main', error: 'error.main', 'needs-auth': 'warning.main',
};

/** Health as a 7px dot — the full state and detail live in the tooltip. */
function HealthDot({ server }: { server: McpServer }): React.ReactElement | null {
  const color = !server.enabled && server.source.kind === 'workspace' ? 'text.disabled' : server.health ? HEALTH_DOT_COLOR[server.health.state] : undefined;
  if (color === undefined) return null;
  const title = server.health ? `${server.health.state}${server.health.detail ? ` — ${server.health.detail}` : ''}` : 'Desabilitado';
  return (
    <Tooltip title={title}>
      <Box component="span" data-testid={`tree-mcp-health-${server.id}`} sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, bgcolor: color }} />
    </Tooltip>
  );
}

const MCP_SCOPE_LABEL: Record<McpServer['scope'], string> = {
  global: 'usuário',
  'project-local': 'projeto (local)',
  'project-shared': 'projeto',
  plugin: 'plugin',
  detected: 'detectado',
};

function isLocal(server: McpServer, matchPath: string | undefined): boolean {
  if (matchPath === undefined) return true;
  const projectScoped = server.scope === 'project-local' || server.scope === 'project-shared' || server.scope === 'detected';
  return projectScoped && server.repoPath === matchPath;
}

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

interface McpTreeGroupProps {
  /** The current project/workspace path a `project-local`/`project-shared` server must match to count as local. Omitted at the Default workspace, where nothing is filtered. */
  matchPath?: string;
  showGlobal: boolean;
  /** Lists only the servers that are NOT local to `matchPath` — the workspace's read-only "Do Global" section. */
  onlyGlobal?: boolean;
  /** Rows only, no group header — see `TreeGroup`'s `flat`. */
  flat?: boolean;
  /** Keeps only servers whose name contains this text. */
  query?: string;
  /** Keeps only the user's own or only plugin-provided servers. Defaults to both. */
  origin?: OriginSegment;
  /** Reports the number of rows this list renders. */
  onCount?: (count: number) => void;
  /** Takes part in a cross-type origin view — see `OriginView`. */
  view?: OriginView;
}

export function McpTreeGroup({ matchPath, showGlobal, onlyGlobal = false, flat = false, query = '', origin = 'all', onCount, view }: McpTreeGroupProps): React.ReactElement {
  const { data } = useMcpList();
  const del = useDeleteMcp();
  const setEnabled = useSetMcpEnabled();
  const authenticate = useAuthenticateMcp();
  const importer = useImportDetected();
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; server?: McpServer } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<McpServer>();
  const rowMenuTarget = rowMenu.state?.target;
  const onMutationError = (err: unknown): void => setToast({ variant: 'error', message: errorMessage(err) });
  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget
    ? [
        ...(needsAuth(rowMenuTarget)
          ? [{ key: 'authenticate', label: 'Autenticar', glyph: KeyRound, onSelect: () => authenticate.mutate({ id: rowMenuTarget.id }) }]
          : []),
        ...(rowMenuTarget.source.kind === 'workspace'
          ? [
              { key: 'toggle', label: rowMenuTarget.enabled ? 'Desativar' : 'Ativar', glyph: Power, onSelect: () => setEnabled.mutate({ id: rowMenuTarget.id, enabled: !rowMenuTarget.enabled }, { onError: onMutationError }) },
              { key: 'edit', label: 'Editar', glyph: Pencil, onSelect: () => setEditor({ mode: 'edit', server: rowMenuTarget }) },
              { key: 'delete', label: 'Excluir', glyph: Trash2, danger: true, onSelect: () => del.mutate({ id: rowMenuTarget.id }, { onError: onMutationError }) },
            ]
          : []),
        ...(rowMenuTarget.source.kind === 'detected' && rowMenuTarget.source.importable === true && rowMenuTarget.source.detectedId !== undefined
          ? [
              {
                key: 'import',
                label: 'Importar',
                glyph: Download,
                onSelect: () => importer.mutate({ id: rowMenuTarget.source.kind === 'detected' ? (rowMenuTarget.source.detectedId ?? '') : '' }, { onError: onMutationError }),
              },
            ]
          : []),
      ]
    : [];

  // Plugin-provided servers offer no menu unless they need authentication; detected ones only when importable.
  const rowMenuActionsFor = (server: McpServer): boolean =>
    server.source.kind === 'workspace' || needsAuth(server) || (server.source.kind === 'detected' && server.source.importable === true);
  const items = data ?? [];
  const localItems = onlyGlobal ? [] : items.filter((s) => isLocal(s, matchPath));
  const globalItems = matchPath !== undefined && (showGlobal || onlyGlobal) ? items.filter((s) => !isLocal(s, matchPath)) : [];
  const visible = [...localItems, ...globalItems]
    .filter((s) => matchesOrigin(origin, s.source.kind === 'plugin'))
    .filter((s) => matchesQuery(query, s.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  useReportCount(visible.length, onCount);
  // Two servers with the same name differ only by where they are configured — say so on those rows.
  const nameCounts = new Map<string, number>();
  for (const s of visible) if (s.source.kind !== 'plugin') nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1);

  return (
    <>
      <TreeGroup
        testId="mcp"
        glyph={Plug}
        label="MCP"
        count={visible.length}
        flat={flat}
        onCreate={() => setEditor({ mode: 'create' })}
        createLabel="Novo servidor MCP"
      >
        <OriginGroups
          glyph={Plug}
          items={visible}
          storageScope={`${matchPath ?? 'home'}:mcp`}
          testId="mcp"
          forceOpen={query.trim() !== ''}
          depth={flat ? 0 : 1}
          plainDepth={0}
          {...(view ? { view } : {})}
          renderRow={(server, depth) => {
            const global = !isLocal(server, matchPath);
            const isDisabled = server.source.kind === 'workspace' && !server.enabled;
            return (
              <TreeGroupRow
                key={server.id}
                testId={`tree-mcp-${server.id}`}
                glyph={Plug}
                mono
                depth={depth}
                accentColor={ENTITY_ACCENT_COLOR.mcp}
                muted={isDisabled || global}
                primary={server.name}
                onContextMenu={(e) => rowMenu.openMenu(e, server)}
                badge={
                  <>
                    {server.source.kind !== 'plugin' && (nameCounts.get(server.name) ?? 0) > 1 && (
                      <Typography component="span" data-testid={`tree-mcp-scope-${server.id}`} noWrap sx={{ flexShrink: 0, fontSize: '0.6875rem', color: 'text.disabled' }}>
                        {MCP_SCOPE_LABEL[server.scope]}
                      </Typography>
                    )}
                    {server.source.kind === 'detected' && server.source.harness !== undefined && (
                      <Typography component="span" data-testid={`tree-mcp-harness-${server.id}`} noWrap sx={{ flexShrink: 0, fontSize: '0.6875rem', color: 'text.disabled' }}>
                        {HARNESS_LABEL[server.source.harness]}
                      </Typography>
                    )}
                    <HealthDot server={server} />
                    <OriginMeta {...(server.source.kind === 'plugin' ? { pluginId: server.source.pluginId } : {})} />
                  </>
                }
                actions={
                  rowMenuActionsFor(server) ? (
                    <RowMenuButton testId={`tree-mcp-menu-${server.id}`} label={`Ações de ${server.name}`} onOpen={(e) => rowMenu.openMenu(e, server)} />
                  ) : undefined
                }
              />
            );
          }}
        />
      </TreeGroup>

      {editor !== null && (
        <McpEditorDialog
          key={editor.server?.id ?? 'create'}
          open
          mode={editor.mode}
          {...(editor.server !== undefined ? { initial: editor.server } : {})}
          onClose={() => setEditor(null)}
        />
      )}
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
