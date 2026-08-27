import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { Trash2 } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { PluginOriginBadge } from '../../components/PluginOriginBadge.js';
import { EntityDataGrid } from '../../components/EntityDataGrid/index.js';
import type {
  EntityDef,
  RowAction,
} from '../../components/EntityDataGrid/index.js';

interface HookHandler {
  type: 'command' | 'http' | 'mcp_tool' | 'prompt' | 'agent';
  command?: string;
  url?: string;
  prompt?: string;
}

interface Hook {
  id: string;
  event: string;
  matcher?: string;
  description?: string;
  handler: HookHandler;
  source: { kind: 'workspace' } | { kind: 'plugin'; pluginId: string };
}

const HOOKS_QUERY_KEY = ['hooks', 'personal'] as const;

export function HookList(): React.ReactElement {
  const qc = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const { data, isLoading, error } = useQuery<Hook[]>({
    queryKey: HOOKS_QUERY_KEY,
    queryFn: async () => {
      const list = await callIpc<Hook[]>('hook.list', { scope: 'personal' });
      return Array.isArray(list) ? list : [];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (hook: Hook) => {
      await callIpc('hook.delete', { id: hook.id, scope: 'personal' });
    },
    onSuccess: async () => {
      setToast({ variant: 'success', message: 'Hook removido' });
      await qc.invalidateQueries({ queryKey: HOOKS_QUERY_KEY });
    },
    onError: (err) => {
      const message = err instanceof IpcCallError ? err.message : String(err);
      setToast({ variant: 'error', message });
    },
  });

  const entity: EntityDef<Hook> = {
    name: 'hook',
    pluralName: 'hooks',
    getKey: (item) => item.id,
    fields: [
      {
        key: 'handler',
        label: 'Handler',
        primary: true,
        searchable: true,
        render: (item, view) =>
          view === 'card' && item.source.kind === 'plugin' ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box component="span">{describeHandler(item.handler)}</Box>
              <PluginOriginBadge pluginId={item.source.pluginId} />
            </Stack>
          ) : (
            describeHandler(item.handler)
          ),
      },
      {
        key: 'plugin',
        label: 'Plugin',
        hideInCard: true,
        width: 160,
        render: (item) =>
          item.source.kind === 'plugin' ? (
            <PluginOriginBadge pluginId={item.source.pluginId} />
          ) : null,
      },
      {
        key: 'event',
        label: 'Event',
        badge: true,
        searchable: true,
      },
      {
        key: 'matcher',
        label: 'Matcher',
        searchable: true,
      },
      {
        key: 'description',
        label: 'Description',
        secondary: true,
        searchable: true,
      },
    ],
  };

  const actions: RowAction<Hook>[] = [
    {
      label: 'Excluir',
      icon: <Icon glyph={Trash2} size={16} />,
      variant: 'destructive',
      hidden: (item) => item.source.kind !== 'workspace',
      onClick: (item) => deleteMutation.mutate(item),
    },
  ];

  return (
    <Container component="main" data-testid="hook-list" maxWidth="lg" sx={{ py: 2.5 }}>
      <Typography variant="h5" component="h1" sx={{ mb: 0.5 }}>
        Hooks
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Hooks disparam em eventos do ciclo de vida do Claude Code. São pessoais — aparecem em todos os
        workspaces. Os criados aqui ficam em <code>~/.claude/settings.json</code>; os de plugin vêm
        empacotados com os plugins instalados.
      </Typography>

      <EntityDataGrid<Hook>
        entity={entity}
        data={data}
        isLoading={isLoading}
        error={error}
        actions={actions}
        searchPlaceholder="Buscar hooks…"
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Container>
  );
}

function describeHandler(handler: HookHandler): string {
  switch (handler.type) {
    case 'command':
      return handler.command ?? '(empty command)';
    case 'http':
      return `HTTP → ${handler.url ?? '(no url)'}`;
    case 'mcp_tool':
      return `MCP tool`;
    case 'prompt':
      return `prompt: ${(handler.prompt ?? '').slice(0, 60)}`;
    case 'agent':
      return `agent: ${(handler.prompt ?? '').slice(0, 60)}`;
    default:
      return handler.type;
  }
}
