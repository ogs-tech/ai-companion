import { useState } from 'react';
import { Tooltip } from '@mui/material';
import { Trash2, Webhook } from 'lucide-react';
import { OriginMeta } from './OriginMeta.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { RowMenuButton } from './RowMenuButton.js';
import { ENTITY_ACCENT_COLOR } from '../shell/nav.js';
import { useDeleteHook, useHooks, type Hook } from '../../hooks/use-hooks.js';
import { describeHookHandler, hookRowLabel } from '../../lib/describe-hook-handler.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { IpcCallError } from '../../lib/ipc.js';
import { matchesOrigin, matchesQuery, useReportCount, type OriginSegment } from '../../lib/control-panel-filter.js';

interface HooksTreeGroupProps {
  /** Hooks have no project/workspace scoping today — everything is the "global" tier. Omitted at the Default workspace, where nothing is filtered. */
  isProjectContext?: boolean;
  showGlobal: boolean;
  /** Rows only, no group header — see `TreeGroup`'s `flat`. */
  flat?: boolean;
  /** Keeps only hooks whose handler description contains this text. */
  query?: string;
  /** Keeps only the user's own or only plugin-provided hooks. Defaults to both. */
  origin?: OriginSegment;
  /** Reports the number of rows this list renders. */
  onCount?: (count: number) => void;
}

/** Hooks are personal-only (no `scopeId`) — inside a project workspace they only show once "Mostrar entidades globais" is on, since none of them are local to begin with. */
export function HooksTreeGroup({ isProjectContext, showGlobal, flat = false, query = '', origin = 'all', onCount }: HooksTreeGroupProps): React.ReactElement {
  const { data } = useHooks();
  const del = useDeleteHook();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Hook>();
  const rowMenuTarget = rowMenu.state?.target;
  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget
    ? [{ key: 'delete', label: 'Excluir', glyph: Trash2, danger: true, onSelect: () => handleDelete(rowMenuTarget.id, describeHookHandler(rowMenuTarget.handler)) }]
    : [];
  const items = (isProjectContext && !showGlobal ? [] : (data ?? [])).filter((h) => matchesOrigin(origin, h.source.kind === 'plugin') && matchesQuery(query, describeHookHandler(h.handler)));
  useReportCount(items.length, onCount);

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
      <TreeGroup testId="hook" glyph={Webhook} label="Hooks" count={items.length} flat={flat}>
        {items.map((item) => (
          <TreeGroupRow
            key={item.id}
            testId={`tree-hook-${item.id}`}
            glyph={Webhook}
            mono
            accentColor={ENTITY_ACCENT_COLOR.hook}
            primary={<Tooltip title={describeHookHandler(item.handler)}><span>{hookRowLabel(item)}</span></Tooltip>}
            badge={
              <OriginMeta
                {...(item.source.kind === 'plugin' ? { pluginId: item.source.pluginId } : {})}
                inherited={isProjectContext === true}
              />
            }
            actions={
              item.source.kind === 'workspace' ? (
                <RowMenuButton testId={`tree-hook-menu-${item.id}`} label="Ações do hook" onOpen={(e) => rowMenu.openMenu(e, item)} />
              ) : undefined
            }
          />
        ))}
      </TreeGroup>
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
