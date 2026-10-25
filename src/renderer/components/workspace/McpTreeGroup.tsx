import { useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { KeyRound, Pencil, Plug, Power, Trash2 } from 'lucide-react';
import { OriginMeta } from './OriginMeta.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { RowMenuButton } from './RowMenuButton.js';
import { ENTITY_ACCENT_COLOR } from '../shell/nav.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useMcpList } from '../../hooks/use-mcp-list.js';
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

function isLocal(server: McpServer, matchPath: string | undefined): boolean {
  if (matchPath === undefined) return true;
  return (server.scope === 'project-local' || server.scope === 'project-shared') && server.repoPath === matchPath;
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
}

export function McpTreeGroup({ matchPath, showGlobal, onlyGlobal = false, flat = false, query = '', origin = 'all', onCount }: McpTreeGroupProps): React.ReactElement {
  const { data } = useMcpList();
  const del = useDeleteMcp();
  const setEnabled = useSetMcpEnabled();
  const authenticate = useAuthenticateMcp();
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
      ]
    : [];

  // Plugin-provided servers offer no menu unless they need authentication.
  const rowMenuActionsFor = (server: McpServer): boolean => server.source.kind === 'workspace' || needsAuth(server);
  const items = data ?? [];
  const localItems = onlyGlobal ? [] : items.filter((s) => isLocal(s, matchPath));
  const globalItems = matchPath !== undefined && (showGlobal || onlyGlobal) ? items.filter((s) => !isLocal(s, matchPath)) : [];
  const visible = [...localItems, ...globalItems]
    .filter((s) => matchesOrigin(origin, s.source.kind === 'plugin'))
    .filter((s) => matchesQuery(query, s.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  useReportCount(visible.length, onCount);

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
        {visible.map((server) => {
          const global = !isLocal(server, matchPath);
          const isDisabled = server.source.kind === 'workspace' && !server.enabled;
          return (
            <TreeGroupRow
              key={server.id}
              testId={`tree-mcp-${server.id}`}
              glyph={Plug}
              mono
              accentColor={ENTITY_ACCENT_COLOR.mcp}
              muted={isDisabled || global}
              primary={server.name}
              onContextMenu={(e) => rowMenu.openMenu(e, server)}
              badge={
                <>
                  <HealthDot server={server} />
                  <OriginMeta {...(server.source.kind === 'plugin' ? { pluginId: server.source.pluginId } : {})} inherited={global} />
                </>
              }
              actions={
                rowMenuActionsFor(server) ? (
                  <RowMenuButton testId={`tree-mcp-menu-${server.id}`} label={`Ações de ${server.name}`} onOpen={(e) => rowMenu.openMenu(e, server)} />
                ) : undefined
              }
            />
          );
        })}
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
