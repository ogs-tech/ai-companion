import { useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { Trash2, Webhook } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { StatusPill } from '../ds/StatusPill.js';
import { PluginOriginBadge } from '../PluginOriginBadge.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { useDeleteHook, useHooks } from '../../hooks/use-hooks.js';
import { describeHookHandler } from '../../lib/describe-hook-handler.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { IpcCallError } from '../../lib/ipc.js';

interface HooksTreeGroupProps {
  /** Hooks have no project/workspace scoping today — everything is the "global" tier. Omitted at the Default workspace, where nothing is filtered. */
  isProjectContext?: boolean;
  showGlobal: boolean;
}

/** Hooks are personal-only (no `scopeId`) — inside a project workspace they only show once "Mostrar entidades globais" is on, since none of them are local to begin with. */
export function HooksTreeGroup({ isProjectContext, showGlobal }: HooksTreeGroupProps): React.ReactElement {
  const { data } = useHooks();
  const del = useDeleteHook();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const items = isProjectContext && !showGlobal ? [] : (data ?? []);

  const handleDelete = (hookId: string, label: string): void => {
    if (!window.confirm(`Remover hook "${label}"?`)) return;
    const hook = (data ?? []).find((h) => h.id === hookId);
    if (!hook) return;
    del.mutate(hook, {
      onError: (err) => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) }),
    });
  };

  return (
    <>
      <TreeGroup testId="hook" glyph={Webhook} label="Hooks" count={items.length}>
        {items.map((item) => (
          <TreeGroupRow
            key={item.id}
            testId={`tree-hook-${item.id}`}
            glyph={Webhook}
            primary={describeHookHandler(item.handler)}
            badge={
              item.source.kind === 'plugin' ? (
                <PluginOriginBadge pluginId={item.source.pluginId} />
              ) : isProjectContext ? (
                <StatusPill variant="idle" label="Global" testId={`hook-global-${item.id}`} />
              ) : undefined
            }
            actions={
              item.source.kind === 'workspace' ? (
                <Tooltip title="Excluir">
                  <Box
                    component="span"
                    role="button"
                    tabIndex={0}
                    aria-label="Excluir hook"
                    data-testid={`tree-hook-delete-${item.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item.id, describeHookHandler(item.handler));
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      if (e.key === ' ') e.preventDefault();
                      e.stopPropagation();
                      handleDelete(item.id, describeHookHandler(item.handler));
                    }}
                    sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                  >
                    <Icon glyph={Trash2} size={14} />
                  </Box>
                </Tooltip>
              ) : undefined
            }
          />
        ))}
      </TreeGroup>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
