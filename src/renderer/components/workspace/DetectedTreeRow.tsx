import { useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { TreeGroupRow } from './TreeGroup.js';
import { RowBadgeSlot, RowLabel, rowTestId } from './RowBadgeSlot.js';
import { RowContextMenu, useRowContextMenu } from './RowContextMenu.js';
import { customizationMenu, toRowActions } from './customization-menu.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useImportDetected } from '../../hooks/use-detected.js';
import { IpcCallError } from '../../lib/ipc.js';
import type { TreeItem } from '../../lib/customization-tree.js';
import type { DetectedEntity } from '../../../shared/detected.js';

export const HARNESS_LABEL: Record<DetectedEntity['harness'], string> = { claude: 'Claude', cursor: 'Cursor' };

/** The harness a detected item was found in, quiet after its name — two harnesses can hold the same name. */
export function HarnessTag({ harness, testId }: { harness: DetectedEntity['harness']; testId?: string }): React.ReactElement {
  return (
    <Box component="span" data-testid={testId} sx={{ flexShrink: 0, fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
      {HARNESS_LABEL[harness]}
    </Box>
  );
}

/** A skill or agent found in Claude's or Cursor's own folders, read-only until imported (tag or "Importar" menu). */
export function DetectedTreeRow({ item, depth = 1 }: { item: TreeItem; depth?: number }): React.ReactElement | null {
  const importer = useImportDetected();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<DetectedEntity>();
  if (item.entity.kind !== 'detected') return null;
  const detected = item.entity.value;

  const runImport = (): void =>
    importer.mutate(
      { id: detected.id },
      {
        onSuccess: () => setToast({ variant: 'success', message: `"${detected.name}" importado` }),
        onError: (err) => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) }),
      },
    );
  // Detected rows: Visualizar + Importar from the registry; there is no preview of a detected file yet, so Visualizar is left out.
  const menu = customizationMenu({
    entity: { kind: detected.kind === 'agent' ? 'agent' : 'skill', name: detected.name, scopes: ['personal'] },
    enabled: true,
    readOnly: false,
    detected: true,
    canInstallOver: false,
    hasUndo: false,
    newAction: false,
  });
  const actions = rowMenu.state ? toRowActions(menu, { import: runImport }) : [];

  return (
    <>
      <TreeGroupRow
        testId={rowTestId(item)}
        depth={depth}
        muted
        primary={
          <Tooltip title={detected.importable ? detected.path : (detected.reason ?? 'Não pode ser importado')}>
            <span>
              <RowLabel item={item} />
            </span>
          </Tooltip>
        }
        {...(detected.importable ? { onContextMenu: (e: React.MouseEvent) => rowMenu.openMenu(e, detected) } : {})}
        badge={
          <>
            <HarnessTag harness={detected.harness} />
            <RowBadgeSlot item={item} onImport={runImport} busy={importer.isPending} />
          </>
        }
      />
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={actions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
