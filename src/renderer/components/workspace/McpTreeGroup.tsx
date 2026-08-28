import { useState } from 'react';
import { Box, Chip, IconButton, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { KeyRound, Pencil, Plug, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { StatusPill } from '../ds/StatusPill.js';
import { PluginOriginBadge } from '../PluginOriginBadge.js';
import { TreeGroup } from './TreeGroup.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useMcpList } from '../../hooks/use-mcp-list.js';
import { useDeleteMcp, useSetMcpEnabled, useAuthenticateMcp } from '../../hooks/use-mcp-mutations.js';
import { IpcCallError } from '../../lib/ipc.js';
import { McpEditorDialog } from '../../screens/mcps/McpEditorDialog.js';
import { needsAuth, type McpHealthState, type McpServer } from '../../../shared/mcp.js';

const HEALTH_PILL: Record<McpHealthState, 'ok' | 'warning' | 'error'> = {
  ok: 'ok', warning: 'warning', error: 'error', 'needs-auth': 'warning',
};

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
}

export function McpTreeGroup({ matchPath, showGlobal }: McpTreeGroupProps): React.ReactElement {
  const { data } = useMcpList();
  const del = useDeleteMcp();
  const setEnabled = useSetMcpEnabled();
  const authenticate = useAuthenticateMcp();
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; server?: McpServer } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const items = data ?? [];
  const localItems = items.filter((s) => isLocal(s, matchPath));
  const globalItems = matchPath !== undefined && showGlobal ? items.filter((s) => !isLocal(s, matchPath)) : [];
  const visible = [...localItems, ...globalItems].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <TreeGroup
        testId="mcp"
        glyph={Plug}
        label="MCP"
        count={visible.length}
        onCreate={() => setEditor({ mode: 'create' })}
        createLabel="Novo servidor MCP"
      >
        {visible.map((server) => {
          const global = !isLocal(server, matchPath);
          const isDisabled = server.source.kind === 'workspace' && !server.enabled;
          return (
            <Box
              key={server.id}
              data-testid={`tree-mcp-${server.id}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.5 + 2.5, pr: 1, py: 0.5, opacity: isDisabled || global ? 0.65 : 1 }}
            >
              <Icon glyph={Plug} size={14} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" noWrap sx={{ fontSize: '0.85rem' }}>{server.name}</Typography>
                {server.health?.detail !== undefined && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {server.health.detail}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                {isDisabled && <Chip size="small" variant="outlined" label="Desabilitado" sx={{ height: 18, fontSize: '0.6875rem' }} />}
                {global && <StatusPill variant="idle" label="Global" testId={`mcp-global-${server.id}`} />}
                {server.health && <StatusPill variant={HEALTH_PILL[server.health.state]} label={server.health.state} />}
                {needsAuth(server) && (
                  <Tooltip title="Authenticate">
                    <IconButton size="small" data-testid={`tree-mcp-authenticate-${server.id}`} disabled={authenticate.isPending}
                      onClick={() => authenticate.mutate({ id: server.id })}>
                      <Icon glyph={KeyRound} size={14} />
                    </IconButton>
                  </Tooltip>
                )}
                {server.source.kind === 'plugin' && (
                  <PluginOriginBadge pluginId={server.source.pluginId} provenance={server.source.provenance} />
                )}
                {server.source.kind === 'workspace' && (
                  <>
                    <Switch
                      size="small"
                      data-testid={`tree-mcp-toggle-${server.id}`}
                      checked={server.enabled}
                      onChange={(e) =>
                        setEnabled.mutate(
                          { id: server.id, enabled: e.target.checked },
                          { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) },
                        )
                      }
                    />
                    <Tooltip title="Editar">
                      <IconButton size="small" data-testid={`tree-mcp-edit-${server.id}`} onClick={() => setEditor({ mode: 'edit', server })}>
                        <Icon glyph={Pencil} size={14} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Excluir">
                      <IconButton
                        size="small"
                        data-testid={`tree-mcp-delete-${server.id}`}
                        onClick={() =>
                          del.mutate({ id: server.id }, { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) })
                        }
                      >
                        <Icon glyph={Trash2} size={14} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Stack>
            </Box>
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
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
