import { useState } from 'react';
import { Tooltip } from '@mui/material';
import { TreeGroupRow } from './TreeGroup.js';
import { RowBadgeSlot, RowLabel, rowMuted, rowTestId } from './RowBadgeSlot.js';
import { customizationMenu, toRowActions } from './customization-menu.js';
import { useSetEntityEnabled } from '../../hooks/use-set-entity-enabled.js';
import { HarnessTag } from './DetectedTreeRow.js';
import { RowContextMenu, useRowContextMenu } from './RowContextMenu.js';
import { useDeleteHook, type Hook } from '../../hooks/use-hooks.js';
import { useImportDetected } from '../../hooks/use-detected.js';
import { useRequestDelete } from '../../hooks/use-undoable-delete.js';
import { describeHookHandler } from '../../lib/describe-hook-handler.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { IpcCallError } from '../../lib/ipc.js';
import type { TreeItem } from '../../lib/customization-tree.js';
import { HookEditorDialog } from '../../screens/hooks/HookEditorDialog.js';

/** One hook, its menu from the kind registry: the user's own are editable; detected ones import; a plugin's is read-only. */
export function HookTreeRow({ item, depth = 1 }: { item: TreeItem; depth?: number }): React.ReactElement | null {
  const del = useDeleteHook();
  const requestDelete = useRequestDelete();
  const setEnabled = useSetEntityEnabled();
  const importer = useImportDetected();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [editing, setEditing] = useState(false);
  const rowMenu = useRowContextMenu<Hook>();
  if (item.entity.kind !== 'hook') return null;
  const hook = item.entity.value;
  const onMutationError = (err: unknown): void => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
  const detectedId = hook.source.kind === 'detected' && hook.source.importable ? hook.source.detectedId : undefined;
  const runImport = detectedId !== undefined ? (): void => importer.mutate({ id: detectedId }, { onError: onMutationError }) : undefined;

  const handleDelete = (): void =>
    requestDelete({ key: item.urn, message: `"${item.name}" excluído`, commit: () => del.mutateAsync(hook) });
  const own = hook.source.kind === 'workspace';
  const actions = !rowMenu.state
    ? []
    : toRowActions(
        customizationMenu({
          entity: { kind: 'hook', name: hook.id, scopes: ['personal'] },
          enabled: hook.enabled !== false,
          readOnly: hook.source.kind === 'plugin' ? 'plugin' : false,
          detected: hook.source.kind === 'detected',
          canInstallOver: false,
          hasUndo: false,
          newAction: false,
        }),
        {
          ...(runImport !== undefined ? { import: runImport } : {}),
          ...(own
            ? {
                edit: () => setEditing(true),
                toggle: () => setEnabled.mutate({ urn: item.urn, enabled: hook.enabled === false }, { onError: onMutationError }),
                delete: handleDelete,
              }
            : {}),
        },
      );
  const hasMenu = own || runImport !== undefined;

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
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
      {editing && (
        <HookEditorDialog open mode="edit" initial={hook} scope="personal" onClose={() => setEditing(false)} onSaved={() => undefined} />
      )}
    </>
  );
}
