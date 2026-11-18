import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { ChannelSetupDialog } from '../config/ChannelSetupDialog.js';
import { McpEditorDialog } from './McpEditorDialog.js';
import { useMcpList } from '../../hooks/use-mcp-list.js';
import { useRefreshMcpHealth } from '../../hooks/use-mcp-mutations.js';
import { useCustomizationStatus } from '../../hooks/use-customization-status.js';
import { useSettings } from '../../hooks/use-settings.js';
import { invalidateHealth } from '../../hooks/use-health-report.js';
import { openDiagnosticsFor } from '../../lib/diagnostics-focus.js';
import { callIpc } from '../../lib/ipc.js';
import { CHANNEL_IDS, CHANNELS, type ChannelId } from '../../../shared/channel.js';
import type { ChannelSetupStart } from '../../../shared/channel-setup.js';
import type { ItemStatus } from '../../../shared/customization-status.js';
import { entityUrn } from '../../../shared/entity.js';
import {
  mcpChannelTargets,
  mcpSignsIn,
  type McpChannelTarget,
  type McpServer,
} from '../../../shared/mcp.js';

const SECTION_SX = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'text.secondary',
  textTransform: 'uppercase',
  mt: 3,
  mb: 1,
} as const;

/** `stdio · npx -y @upstash/context7-mcp`, `http · https://…`: what runs, in one line. */
function definitionLine(server: McpServer): string {
  const { def } = server;
  const target =
    typeof def['url'] === 'string'
      ? def['url']
      : [def['command'], ...(Array.isArray(def['args']) ? def['args'] : [])]
          .filter((p) => typeof p === 'string')
          .join(' ');
  return [server.transport, target].filter((p) => p !== undefined && p !== '').join(' · ');
}

function originLine(server: McpServer): string {
  const { source } = server;
  if (source.kind === 'plugin') return `Plugin ${source.pluginId} · somente leitura`;
  if (source.kind === 'detected')
    return `Detectado no ${CHANNELS[source.harness ?? 'claude'].displayName}`;
  return 'Seu · escrito em todos os canais ativos';
}

type ChannelState = { tone: 'ok' | 'error' | 'quiet'; label: string; detail?: string };

/**
 * What the app actually knows per channel. Claude and Cursor report a live connection through their own CLI
 * (`claude mcp list`, `cursor-agent mcp list`); without one the app only knows whether the entry was written,
 * so the label says that and nothing more.
 */
function channelState(
  channelId: ChannelId,
  server: McpServer,
  status: ItemStatus | undefined,
): ChannelState {
  const channel = status?.channels[channelId];
  const live = channelId === 'claude' ? server.health : server.channelHealth?.[channelId];
  if (live !== undefined) {
    const { state, detail } = live;
    if (state === 'ok') return { tone: 'ok', label: 'Conectado' };
    if (state === 'needs-auth') return { tone: 'error', label: 'Precisa de login' };
    if (state === 'warning') return { tone: 'quiet', label: detail ?? 'Atenção' };
    return { tone: 'error', label: 'Erro', ...(detail !== undefined ? { detail } : {}) };
  }
  if (channel?.status === 'error') return { tone: 'error', label: 'Erro' };
  if (channel?.status === 'installed') return { tone: 'ok', label: 'Configurado' };
  return { tone: 'quiet', label: 'Não verificado' };
}

interface LoginRun {
  queue: readonly McpChannelTarget[];
  index: number;
  terminalId: string;
  title: string;
}

/**
 * One MCP server as a Workbench page: what it runs, one sign-in for every channel it lives in, then each channel's
 * state. Sign-in runs each channel's own `mcp login` in a visible terminal, one after the other — every CLI keeps
 * its own OAuth token, so "Conectar em todos" is one click and one login per channel, not a shared token.
 */
export function McpPage({ serverId }: { serverId: string }): React.ReactElement {
  const qc = useQueryClient();
  const { data: servers, isLoading } = useMcpList();
  const statusByUrn = useCustomizationStatus();
  const { data: settings } = useSettings();
  const refreshHealth = useRefreshMcpHealth();
  const [run, setRun] = useState<LoginRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Stable: the dialog re-subscribes to the PTY's exit whenever this changes.
  const { mutate: refreshMutate } = refreshHealth;
  const recheck = useCallback((): void => {
    refreshMutate(undefined, { onSettled: () => void invalidateHealth(qc) });
  }, [refreshMutate, qc]);

  // Opening the page re-checks the live state: without it Cursor's row only knows the entry was written.
  useEffect(() => {
    recheck();
  }, [serverId, recheck]);

  const server = servers?.find((s) => s.id === serverId);
  if (server === undefined) {
    return (
      <Box data-testid="mcp-page" sx={{ p: 3 }}>
        <Typography color="text.secondary">
          {isLoading ? 'Carregando…' : 'Este servidor não está mais configurado.'}
        </Typography>
      </Box>
    );
  }

  const urn = entityUrn('mcp', server.name);
  const enabled = CHANNEL_IDS.filter((id) => settings?.adapters[id]?.enabled === true);
  const targets = mcpChannelTargets(server, enabled);
  const own = server.source.kind === 'workspace';

  const startLogin = async (queue: readonly McpChannelTarget[], index: number): Promise<void> => {
    const target = queue[index];
    if (target === undefined) return;
    setError(null);
    try {
      const started = await callIpc<ChannelSetupStart>('channelSetup.mcpLogin', {
        channelId: target.channelId,
        server: target.loginName,
      });
      if (started.kind === 'terminal')
        setRun({ queue, index, terminalId: started.terminalId, title: started.title });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const nextTarget = run !== null ? run.queue[run.index + 1] : undefined;

  return (
    <Box data-testid="mcp-page" sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 600 }}>
          {server.name}
        </Typography>
        <Typography variant="body2" color="text.secondary" data-testid="mcp-page-origin">
          {originLine(server)}
        </Typography>
        {own && (
          <Button
            size="small"
            sx={{ ml: 'auto' }}
            data-testid="mcp-page-edit"
            onClick={() => setEditing(true)}
          >
            Editar
          </Button>
        )}
      </Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, mt: 0.5, wordBreak: 'break-all' })}
      >
        {definitionLine(server)}
      </Typography>

      <Typography sx={SECTION_SX}>Autenticação</Typography>
      {targets.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nenhum canal ativo usa este servidor.
        </Typography>
      ) : mcpSignsIn(server) ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="contained"
            size="small"
            data-testid="mcp-page-connect"
            disabled={run !== null}
            onClick={() => void startLogin(targets, 0)}
          >
            {targets.length > 1
              ? 'Conectar em todos'
              : `Conectar no ${CHANNELS[targets[0]!.channelId].displayName}`}
          </Button>
          <Typography variant="body2" color="text.secondary">
            {targets.length > 1
              ? 'Um login por canal: cada um guarda o próprio token.'
              : 'O login abre no navegador.'}
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" data-testid="mcp-page-no-login">
          Sem login: chaves vão em <code>env</code> na config
          {own ? ', escrita igual em todos os canais' : ''}.
        </Typography>
      )}
      {error !== null && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}

      {targets.length > 0 && (
        <>
          <Typography sx={SECTION_SX}>Canais</Typography>
          {targets.map(({ channelId }) => {
            const state = channelState(channelId, server, statusByUrn[urn]);
            return (
              <Box
                key={channelId}
                data-testid={`mcp-page-channel-${channelId}`}
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 1.5,
                  py: 0.75,
                  borderTop: 1,
                  borderColor: 'divider',
                }}
              >
                <Typography variant="body2" sx={{ width: 96, flexShrink: 0 }}>
                  {CHANNELS[channelId].displayName}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    flexShrink: 0,
                    color:
                      state.tone === 'error'
                        ? 'error.main'
                        : state.tone === 'ok'
                          ? 'success.main'
                          : 'text.secondary',
                  }}
                >
                  {state.tone === 'error' ? '● ' : state.tone === 'ok' ? '✓ ' : ''}
                  {state.label}
                </Typography>
                {state.detail !== undefined && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    noWrap
                    title={state.detail}
                    sx={{ minWidth: 0 }}
                  >
                    {state.detail}
                  </Typography>
                )}
                {state.tone === 'error' && (
                  <Button
                    size="small"
                    sx={{ ml: 'auto', flexShrink: 0 }}
                    onClick={() => openDiagnosticsFor(urn)}
                  >
                    Ver diagnóstico
                  </Button>
                )}
              </Box>
            );
          })}
        </>
      )}

      {run !== null && (
        <ChannelSetupDialog
          key={run.terminalId}
          terminalId={run.terminalId}
          title={run.title}
          {...(nextTarget !== undefined
            ? {
                next: {
                  label: `Conectar no ${CHANNELS[nextTarget.channelId].displayName}`,
                  onClick: () => {
                    setRun(null);
                    void startLogin(run.queue, run.index + 1);
                  },
                },
              }
            : {})}
          onExited={recheck}
          onClose={() => {
            setRun(null);
            recheck();
          }}
        />
      )}
      {editing && (
        <McpEditorDialog
          key={server.id}
          open
          mode="edit"
          initial={server}
          onClose={() => setEditing(false)}
        />
      )}
    </Box>
  );
}
