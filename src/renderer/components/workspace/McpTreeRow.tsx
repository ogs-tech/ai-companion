import { useState } from 'react';
import { Typography } from '@mui/material';
import { KeyRound } from 'lucide-react';
import { TreeGroupRow } from './TreeGroup.js';
import { RowLabel, RowSignal, rowMuted, rowMutedStyle, rowTestId } from './RowBadgeSlot.js';
import { customizationMenu, toRowActions } from './customization-menu.js';
import { useRequestDelete } from '../../hooks/use-undoable-delete.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useImportDetected } from '../../hooks/use-detected.js';
import { useDeleteMcp } from '../../hooks/use-mcp-mutations.js';
import { useSetEntityEnabled } from '../../hooks/use-set-entity-enabled.js';
import { IpcCallError } from '../../lib/ipc.js';
import { openMcpPage } from '../../lib/workspace-area-store.js';
import { McpEditorDialog } from '../../screens/mcps/McpEditorDialog.js';
import { needsAuth, type McpServer } from '../../../shared/mcp.js';
import type { TreeItem } from '../../lib/customization-tree.js';
import { entityUrn } from '../../../shared/entity.js';

const MCP_SCOPE_LABEL: Record<McpServer['scope'], string> = {
  global: 'usuário',
  'project-local': 'projeto (local)',
  'project-shared': 'projeto',
  plugin: 'plugin',
  detected: 'detectado',
};

const QUIET_SX = { flexShrink: 0, fontSize: '0.75rem', color: 'text.secondary' } as const;

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

interface McpTreeRowProps {
  item: TreeItem;
  /** Another listed server has the same name: say where this one is configured. */
  showScope?: boolean;
  depth?: number;
}

/**
 * One MCP server: a click opens its page (`McpPage`), where sign-in happens. Its one signal is a channel mark with a
 * badge (sign-in pending reads as an error there); the menu leads with what resolves it — Conectar (to the same
 * page) or Importar — then toggle/edit/delete for the user's own.
 */
export function McpTreeRow({ item, showScope = false, depth = 1 }: McpTreeRowProps): React.ReactElement | null {
  const del = useDeleteMcp();
  const requestDelete = useRequestDelete();
  const setEnabled = useSetEntityEnabled();
  const importer = useImportDetected();
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<McpServer>();
  if (item.entity.kind !== 'mcp') return null;
  const server = item.entity.value;
  const onMutationError = (err: unknown): void => setToast({ variant: 'error', message: errorMessage(err) });
  const detectedId = server.source.kind === 'detected' && server.source.importable === true ? server.source.detectedId : undefined;
  const runImport = detectedId !== undefined ? (): void => importer.mutate({ id: detectedId, kind: 'mcp' }, { onError: onMutationError }) : undefined;

  const own = server.source.kind === 'workspace';
  const lifecycle = toRowActions(
    customizationMenu({
      entity: { kind: 'mcp', name: server.name, scopes: ['personal'] },
      enabled: server.enabled,
      readOnly: server.source.kind === 'plugin' ? 'plugin' : false,
      detected: server.source.kind === 'detected',
      canInstallOver: false,
      hasUndo: false,
      newAction: false,
    }),
    {
      ...(runImport !== undefined ? { import: runImport } : {}),
      ...(own
        ? {
            edit: () => setEditing(true),
            toggle: () => setEnabled.mutate({ urn: entityUrn('mcp', server.name), enabled: !server.enabled }, { onError: onMutationError }),
            delete: () => requestDelete({ key: item.urn, message: `"${server.name}" excluído`, commit: () => del.mutateAsync({ id: server.id }) }),
          }
        : {}),
    },
  );
  // A detected server is the channel's until imported: it signs in once it is the app's.
  const authPending = server.source.kind !== 'detected' && needsAuth(server);
  const actions: RowContextMenuAction[] = rowMenu.state
    ? [
        ...(authPending ? [{ key: 'authenticate', label: 'Conectar', glyph: KeyRound, emphasis: true, onSelect: () => openMcpPage(server) }] : []),
        ...lifecycle.map((a, i) => (authPending && i === 0 ? { ...a, separatorBefore: true } : a)),
      ]
    : [];
  // Detected servers offer a menu only when importable.
  const hasMenu = own || authPending || runImport !== undefined;

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        depth={depth}
        muted={rowMuted(item)}
        mutedStyle={rowMutedStyle(item)}
        primary={<RowLabel item={item} />}
        onClick={() => openMcpPage(server)}
        {...(hasMenu ? { onContextMenu: (e: React.MouseEvent) => rowMenu.openMenu(e, server) } : {})}
        badge={
          <>
            {showScope && (
              <Typography component="span" data-testid={`tree-mcp-scope-${server.id}`} noWrap sx={QUIET_SX}>
                {MCP_SCOPE_LABEL[server.scope]}
              </Typography>
            )}
            <RowSignal item={item} usage={{ kind: 'mcp', name: server.name }} {...(authPending ? { authChannel: 'claude' as const } : {})} />
          </>
        }
      />
      {editing && <McpEditorDialog key={server.id} open mode="edit" initial={server} onClose={() => setEditing(false)} />}
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={actions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
