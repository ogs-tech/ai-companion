import { useEffect, useState } from 'react';
import { Button, Typography } from '@mui/material';
import { Download, KeyRound, Pencil, Plug, Power, Trash2 } from 'lucide-react';
import { SessionsUsingBadge } from './SessionsUsingBadge.js';
import { TreeGroupRow } from './TreeGroup.js';
import { RowBadgeSlot, RowLabel, rowMuted, rowTestId } from './RowBadgeSlot.js';
import { HarnessTag } from './DetectedTreeRow.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useImportDetected } from '../../hooks/use-detected.js';
import { useDeleteMcp, useSetMcpEnabled, useAuthenticateMcp, useRefreshMcpHealth } from '../../hooks/use-mcp-mutations.js';
import { IpcCallError } from '../../lib/ipc.js';
import { McpEditorDialog } from '../../screens/mcps/McpEditorDialog.js';
import { isClaudeManagedMcp, needsAuth, type McpServer } from '../../../shared/mcp.js';
import type { TreeItem } from '../../lib/customization-tree.js';

const MCP_SCOPE_LABEL: Record<McpServer['scope'], string> = {
  global: 'usuário',
  'project-local': 'projeto (local)',
  'project-shared': 'projeto',
  plugin: 'plugin',
  detected: 'detectado',
};

const QUIET_SX = { flexShrink: 0, fontSize: '0.6875rem', color: 'text.disabled' } as const;

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

interface McpTreeRowProps {
  item: TreeItem;
  /** Another listed server has the same name: say where this one is configured. */
  showScope?: boolean;
  depth?: number;
}

/** One MCP server: toggle/edit/delete for the user's own, "Autenticar" when it needs auth, "Importar" when detected. */
export function McpTreeRow({ item, showScope = false, depth = 1 }: McpTreeRowProps): React.ReactElement | null {
  const del = useDeleteMcp();
  const setEnabled = useSetMcpEnabled();
  const authenticate = useAuthenticateMcp();
  const refreshHealth = useRefreshMcpHealth();
  const importer = useImportDetected();
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // Connecting happens in the browser; the app can't see it finish, so it re-checks once the user comes back.
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  useEffect(() => {
    if (!awaitingReturn) return undefined;
    const onFocus = (): void => {
      setAwaitingReturn(false);
      refreshHealth.mutate(undefined, { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) });
    };
    window.addEventListener('focus', onFocus, { once: true });
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mutate` is stable; the mutation object is not.
  }, [awaitingReturn]);
  const rowMenu = useRowContextMenu<McpServer>();
  if (item.entity.kind !== 'mcp') return null;
  const server = item.entity.value;
  const onMutationError = (err: unknown): void => setToast({ variant: 'error', message: errorMessage(err) });
  const detectedId = server.source.kind === 'detected' && server.source.importable === true ? server.source.detectedId : undefined;
  const runImport = detectedId !== undefined ? (): void => importer.mutate({ id: detectedId }, { onError: onMutationError }) : undefined;

  const actions: RowContextMenuAction[] = rowMenu.state
    ? [
        ...(needsAuth(server) ? [{ key: 'authenticate', label: 'Autenticar', glyph: KeyRound, onSelect: () => authenticate.mutate({ id: server.id }) }] : []),
        ...(server.source.kind === 'workspace'
          ? [
              { key: 'toggle', label: server.enabled ? 'Desativar' : 'Ativar', glyph: Power, onSelect: () => setEnabled.mutate({ id: server.id, enabled: !server.enabled }, { onError: onMutationError }) },
              { key: 'edit', label: 'Editar', glyph: Pencil, onSelect: () => setEditing(true) },
              { key: 'delete', label: 'Excluir', glyph: Trash2, danger: true, onSelect: () => del.mutate({ id: server.id }, { onError: onMutationError }) },
            ]
          : []),
        ...(runImport !== undefined ? [{ key: 'import', label: 'Importar', glyph: Download, onSelect: runImport }] : []),
      ]
    : [];
  // Detected servers offer a menu only when importable.
  const hasMenu = server.source.kind === 'workspace' || needsAuth(server) || runImport !== undefined;

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        glyph={Plug}
        mono
        depth={depth}
        muted={rowMuted(item)}
        primary={<RowLabel item={item} />}
        {...(hasMenu ? { onContextMenu: (e: React.MouseEvent) => rowMenu.openMenu(e, server) } : {})}
        badge={
          <>
            {showScope && (
              <Typography component="span" data-testid={`tree-mcp-scope-${server.id}`} noWrap sx={QUIET_SX}>
                {MCP_SCOPE_LABEL[server.scope]}
              </Typography>
            )}
            {server.source.kind === 'detected' && server.source.harness !== undefined && (
              <HarnessTag harness={server.source.harness} testId={`tree-mcp-harness-${server.id}`} />
            )}
            {isClaudeManagedMcp(server.name) && (
              <Typography component="span" data-testid={`tree-mcp-managed-${server.id}`} noWrap sx={QUIET_SX}>
                Gerenciado pelo Claude
              </Typography>
            )}
            {server.name.startsWith('claude-ai-') && (server.health?.state === 'error' || needsAuth(server)) && (
              <Button
                size="small"
                variant="outlined"
                data-testid={`tree-mcp-connect-${server.id}`}
                disabled={refreshHealth.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  authenticate.mutate({ id: server.id }, { onSuccess: () => setAwaitingReturn(true), onError: onMutationError });
                }}
                sx={{ flexShrink: 0, minWidth: 0, py: 0, px: 0.75, fontSize: '0.6875rem', textTransform: 'none' }}
              >
                {refreshHealth.isPending ? 'Verificando…' : 'Conectar'}
              </Button>
            )}
            <SessionsUsingBadge usage={{ kind: 'mcp', name: server.name }} testId={`tree-mcp-using-${server.id}`} />
            <RowBadgeSlot item={item} {...(runImport !== undefined ? { onImport: runImport } : {})} busy={importer.isPending} />
          </>
        }
      />
      {editing && <McpEditorDialog key={server.id} open mode="edit" initial={server} onClose={() => setEditing(false)} />}
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={actions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
