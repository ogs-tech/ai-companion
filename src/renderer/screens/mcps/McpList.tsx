import { useState } from 'react';
import { Box, Button, Chip, CircularProgress, Container, Divider, IconButton, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { Plus, Pencil, Trash2, KeyRound } from 'lucide-react';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { Icon } from '../../components/ds/Icon.js';
import { StatusPill } from '../../components/ds/StatusPill.js';
import { PluginOriginBadge } from '../../components/PluginOriginBadge.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { useMcpList } from '../../hooks/use-mcp-list.js';
import { useDeleteMcp, useSetMcpEnabled, useAuthenticateMcp } from '../../hooks/use-mcp-mutations.js';
import { IpcCallError } from '../../lib/ipc.js';
import { McpEditorDialog } from './McpEditorDialog.js';
import { needsAuth, type McpHealthState, type McpScope, type McpServer } from '../../../shared/mcp.js';

const SCOPE_LABEL: Record<McpScope, string> = {
  global: 'Personal',
  'project-local': 'Project (local)',
  'project-shared': 'Project (shared)',
  plugin: 'Plugin',
  detected: 'Detected',
};

const HEALTH_PILL: Record<McpHealthState, 'ok' | 'warning' | 'error'> = {
  ok: 'ok',
  warning: 'warning',
  error: 'error',
  'needs-auth': 'warning',
};

function HealthBadge({ server }: { server: McpServer }): React.ReactElement | null {
  if (!server.health) return null;
  return <StatusPill variant={HEALTH_PILL[server.health.state]} label={server.health.state} />;
}

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

export function McpList(): React.ReactElement {
  const { data, isLoading } = useMcpList();
  const servers = data ?? [];
  const del = useDeleteMcp();
  const setEnabled = useSetMcpEnabled();
  const authenticate = useAuthenticateMcp();
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; server?: McpServer } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  return (
    <Container component="main" data-testid="mcp-screen" maxWidth="lg" sx={{ py: 2.5 }}>
      <ScreenHeader
        kicker="Workspace"
        title="MCP"
        {...(data !== undefined ? { subtitle: `${servers.length} server(s)` } : {})}
        actions={
          <Button
            variant="outlined" size="small" data-testid="mcp-new"
            startIcon={<Icon glyph={Plus} size={16} />}
            onClick={() => setEditor({ mode: 'create' })}
          >
            New
          </Button>
        }
      />

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!isLoading && (
        <Stack divider={<Divider />} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {servers.map((server) => {
            const isDisabled = server.source.kind === 'workspace' && !server.enabled;
            return (
            <Box
              key={server.id}
              data-testid={`mcp-row-${server.id}`}
              sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Box sx={{ minWidth: 0, opacity: isDisabled ? 0.55 : 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2">{server.name}</Typography>
                  {isDisabled && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label="Desabilitado"
                      data-testid={`mcp-disabled-badge-${server.id}`}
                      sx={{ height: 20, fontSize: 11 }}
                    />
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {[server.transport, SCOPE_LABEL[server.scope]].filter(Boolean).join(' · ')}
                </Typography>
                {server.health?.detail !== undefined && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {server.health.detail}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <HealthBadge server={server} />
                {needsAuth(server) && (
                  <Button
                    variant="outlined" size="small" data-testid={`mcp-authenticate-${server.id}`}
                    startIcon={<Icon glyph={KeyRound} size={14} />}
                    disabled={authenticate.isPending}
                    onClick={() => authenticate.mutate({ id: server.id })}
                  >
                    Authenticate
                  </Button>
                )}
                {server.source.kind === 'plugin' && (
                  <PluginOriginBadge
                    pluginId={server.source.pluginId}
                    provenance={server.source.provenance}
                  />
                )}
                {server.source.kind === 'workspace' && (
                  <>
                    <Switch
                      size="small" data-testid={`mcp-toggle-${server.id}`}
                      checked={server.enabled}
                      onChange={(e) =>
                        setEnabled.mutate(
                          { id: server.id, enabled: e.target.checked },
                          { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) },
                        )
                      }
                    />
                    <Tooltip title="Edit">
                      <IconButton
                        size="small" data-testid={`mcp-edit-${server.id}`}
                        onClick={() => setEditor({ mode: 'edit', server })}
                      >
                        <Icon glyph={Pencil} size={16} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small" data-testid={`mcp-delete-${server.id}`}
                        onClick={() =>
                          del.mutate(
                            { id: server.id },
                            { onError: (err) => setToast({ variant: 'error', message: errorMessage(err) }) },
                          )
                        }
                      >
                        <Icon glyph={Trash2} size={16} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Stack>
            </Box>
            );
          })}
        </Stack>
      )}

      {editor !== null && (
        <McpEditorDialog
          key={editor.server?.id ?? 'create'}
          open mode={editor.mode}
          {...(editor.server !== undefined ? { initial: editor.server } : {})}
          onClose={() => setEditor(null)}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Container>
  );
}
