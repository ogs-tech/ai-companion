import { useState } from 'react';
import { Tooltip } from '@mui/material';
import { Download, Trash2, Webhook } from 'lucide-react';
import { TreeGroupRow } from './TreeGroup.js';
import { RowBadgeSlot, RowLabel, rowMuted, rowTestId } from './RowBadgeSlot.js';
import { HarnessTag } from './DetectedTreeRow.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { useDeleteHook, type Hook } from '../../hooks/use-hooks.js';
import { useImportDetected } from '../../hooks/use-detected.js';
import { describeHookHandler } from '../../lib/describe-hook-handler.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { IpcCallError } from '../../lib/ipc.js';
import type { TreeItem } from '../../lib/customization-tree.js';

/** One hook: "Excluir" for the user's own, "Importar" for a detected, importable one. No editor exists for hooks. */
export function HookTreeRow({ item, depth = 1 }: { item: TreeItem; depth?: number }): React.ReactElement | null {
  const del = useDeleteHook();
  const importer = useImportDetected();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Hook>();
  if (item.entity.kind !== 'hook') return null;
  const hook = item.entity.value;
  const onMutationError = (err: unknown): void => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
  const detectedId = hook.source.kind === 'detected' && hook.source.importable ? hook.source.detectedId : undefined;
  const runImport = detectedId !== undefined ? (): void => importer.mutate({ id: detectedId }, { onError: onMutationError }) : undefined;

  const handleDelete = (): void => {
    if (!window.confirm(`Remover hook "${describeHookHandler(hook.handler)}"?`)) return;
    del.mutate(hook, { onError: onMutationError });
  };
  const actions: RowContextMenuAction[] = !rowMenu.state
    ? []
    : runImport !== undefined
      ? [{ key: 'import', label: 'Importar', glyph: Download, onSelect: runImport }]
      : [{ key: 'delete', label: 'Excluir', glyph: Trash2, danger: true, onSelect: handleDelete }];
  const hasMenu = hook.source.kind === 'workspace' || runImport !== undefined;

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        glyph={Webhook}
        mono
        depth={depth}
        muted={rowMuted(item)}
        primary={
          <Tooltip title={describeHookHandler(hook.handler)}>
            <span>
              <RowLabel item={item} />
            </span>
          </Tooltip>
        }
        badge={
          <>
            {hook.source.kind === 'detected' && <HarnessTag harness={hook.source.harness} />}
            <RowBadgeSlot item={item} {...(runImport !== undefined ? { onImport: runImport } : {})} busy={importer.isPending} />
          </>
        }
        {...(hasMenu ? { onContextMenu: (e: React.MouseEvent) => rowMenu.openMenu(e, hook) } : {})}
      />
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={actions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
