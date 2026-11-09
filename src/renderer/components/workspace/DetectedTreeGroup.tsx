import { useState } from 'react';
import { Stack, Tooltip, Typography } from '@mui/material';
import { SyncDot } from '../ds/SyncDot.js';
import { Download, ScanSearch } from 'lucide-react';
import { TreeGroupRow } from './TreeGroup.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useDetected, useImportDetected } from '../../hooks/use-detected.js';
import { IpcCallError } from '../../lib/ipc.js';
import { matchesQuery } from '../../lib/control-panel-filter.js';
import type { DetectedEntity } from '../../../shared/detected.js';

export const HARNESS_LABEL: Record<DetectedEntity['harness'], string> = { claude: 'Claude', cursor: 'Cursor' };

interface DetectedScope {
  scope: 'workspace';
  /** `undefined` = every folder, `null` = the workspace's shared set (nothing is detected there), a string = that folder. */
  folder?: string | null;
}

/**
 * Skills or agents found in Claude's and Cursor's own folders that belong to the
 * given scope: the open workspace (optionally one of its folders) or, without a
 * `scope`, the personal home. Read-only until imported.
 */
export function useDetectedItems(kind: 'skill' | 'agent', scope: DetectedScope | undefined, query: string, enabled = true): DetectedEntity[] {
  const { data } = useDetected([kind]);
  if (!enabled) return [];
  return (data ?? [])
    .filter((d) => d.kind === kind)
    .filter((d) => (scope === undefined ? d.scope === 'personal' : d.scope === 'workspace' && (scope.folder === undefined || (scope.folder !== null && d.folder === scope.folder))))
    .filter((d) => matchesQuery(query, d.name, d.description))
    .sort((a, b) => a.name.localeCompare(b.name) || a.harness.localeCompare(b.harness));
}

interface DetectedRowsProps {
  items: DetectedEntity[];
  /** Indent of the rows — the same as the sibling entity rows in the group. */
  depth: number;
}

/** Rows for detected items, with the "Importar" row menu. Renders inside the kind's own group. */
export function DetectedRows({ items, depth }: DetectedRowsProps): React.ReactElement {
  const importer = useImportDetected();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<DetectedEntity>();
  const target = rowMenu.state?.target;

  const actions: RowContextMenuAction[] =
    target?.importable === true
      ? [
          {
            key: 'import',
            label: 'Importar',
            glyph: Download,
            onSelect: () =>
              importer.mutate(
                { id: target.id },
                {
                  onSuccess: () => setToast({ variant: 'success', message: `"${target.name}" importado` }),
                  onError: (err) => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) }),
                },
              ),
          },
        ]
      : [];

  return (
    <>
      {items.map((item) => (
        <TreeGroupRow
          key={item.id}
          testId={`tree-detected-${item.id}`}
          glyph={ScanSearch}
          depth={depth}
          muted
          mono
          primary={item.importable ? item.name : <Tooltip title={item.reason ?? 'Não pode ser importado'}><span>{item.name}</span></Tooltip>}
          {...(item.importable ? { onContextMenu: (e: React.MouseEvent) => rowMenu.openMenu(e, item) } : {})}
          badge={
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <SyncDot state="detected" />
              <Typography component="span" noWrap sx={{ flexShrink: 0, fontSize: '0.6875rem', color: 'text.disabled' }}>
                detectado · {HARNESS_LABEL[item.harness]}{item.importable ? '' : ' · não importável'}
              </Typography>
            </Stack>
          }
        />
      ))}
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={actions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
