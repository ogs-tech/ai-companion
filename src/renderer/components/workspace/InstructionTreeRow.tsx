import { Box, Stack } from '@mui/material';
import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { TreeRow } from '../ds/TreeRow.js';
import { SyncDot } from '../ds/SyncDot.js';
import { RowBadgeSlot, RowLabel, useInstallOver } from './RowBadgeSlot.js';
import type { TreeItem } from '../../lib/customization-tree.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RowContextMenu, useRowContextMenu } from './RowContextMenu.js';
import { customizationMenu, toRowActions } from './customization-menu.js';
import { useSetEntityEnabled } from '../../hooks/use-set-entity-enabled.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { useInvalidateInstructions } from '../../hooks/use-instructions.js';
import { useRequestDelete } from '../../hooks/use-undoable-delete.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import { useImportDetected } from '../../hooks/use-detected.js';
import type { DetectedEntity } from '../../../shared/detected.js';
import type { Instruction } from '../../../shared/entity.js';

type InstructionRowKind = 'personal' | 'workspace' | 'folder';

const ROW_COPY: Record<InstructionRowKind, { label: string; removeLabel?: (name: string) => string }> = {
  personal: { label: 'Instructions' },
  workspace: {
    label: 'Instructions',
    removeLabel: (name) => `Remover as instructions deste workspace (${name})?`,
  },
  folder: {
    label: 'Instructions',
    removeLabel: (name) => `Remover as instructions desta pasta (${name})?`,
  },
};

/** The detected file at the end of the row: its name, then a quiet "Importar" — one action per row. */
function DetectedBadge({ detected, onApply, busy }: { detected: DetectedEntity; onApply: () => void; busy: boolean }): React.ReactElement {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Box
        component="span"
        data-testid="detected-file"
        sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.6875rem', color: 'text.disabled', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 })}
      >
        {String(detected.preview['file'] ?? detected.description)}
      </Box>
      <Box
        component="button"
        type="button"
        disabled={busy}
        data-testid="detected-apply"
        aria-label={`Importar ${String(detected.preview['file'] ?? 'arquivo detectado')} como instructions`}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onApply();
        }}
        sx={(theme) => ({
          font: 'inherit',
          fontSize: '0.75rem',
          color: theme.palette.info.main,
          background: 'none',
          border: 0,
          borderRadius: `${theme.ogs.radius.xs}px`,
          px: 0.5,
          py: 0.25,
          cursor: 'pointer',
          flexShrink: 0,
          '&:hover': { bgcolor: `${theme.palette.info.main}24` },
          '&:disabled': { opacity: 0.5, cursor: 'default' },
        })}
      >
        Importar
      </Box>
      <SyncDot state="detected" />
    </Stack>
  );
}

interface InstructionTreeRowProps {
  kind: InstructionRowKind;
  instruction: Instruction | null | undefined;
  seed: () => Instruction;
  onOpen: (entity: Instruction, isCreate: boolean) => void;
  /** Right-click → "Preview". Omitted entirely (no context menu) while `instruction` is null/undefined — nothing saved yet to preview. */
  onPreview?: (entity: Instruction) => void;
  /** Right-click → "Properties". Also gated on `instruction` being configured, and never offered for `kind="personal"` — every Properties field is hidden there (name/scope/description/version are all fixed), so there's nothing to edit. */
  onProperties?: (entity: Instruction) => void;
  /** Right-click → "New Action" — opens a brand-new session with a draft first message referencing this instruction. Gated on `instruction` being configured (nothing to reference otherwise), but — unlike Properties — offered for `kind="personal"` too, since starting a session from it is meaningful even though there's nothing to edit. */
  onNewAction?: (entity: Instruction) => void;
  /** Overrides the default `data-testid` (`${kind}-instruction-row`). */
  testId?: string;
  /** Overrides the row's "instructions" label — e.g. the instruction's own name, when a workspace lists several. */
  label?: string;
  /** Tree nesting level, matching `FolderTree`'s `TreeNode` indent formula (`pl: 1.5 + depth * 2`). Defaults to `0` (top-level, unindented). */
  depth?: number;
  /**
   * A file of this level that the app does not own, found in a harness's own config. While the
   * level has no Instruction, the row offers it ("Importar"); a click on the row itself still
   * starts an empty one.
   */
  detected?: DetectedEntity | undefined;
  /** The row in the Customizações tree: its label (with the folder tag) and trailing tag. */
  item?: TreeItem;
}

/**
 * A pinned tree-node row for the personal/workspace instruction —
 * sits at the top of a file list (FolderTree, or Início's management list), styled identically to a folder/file row (same icon size,
 * same trailing action-icon treatment) so it reads as one more node rather
 * than a distinct UI concept.
 */
export function InstructionTreeRow({ kind, instruction, seed, onOpen, onPreview, onProperties, onNewAction, testId, label, depth = 0, detected, item }: InstructionTreeRowProps): React.ReactElement {
  const copy = ROW_COPY[kind];
  const rowTestId = testId ?? `${kind}-instruction-row`;
  const invalidate = useInvalidateInstructions();
  const requestDelete = useRequestDelete();
  const setEnabled = useSetEntityEnabled();
  const installOver = useInstallOver(item);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const importer = useImportDetected();
  const offered = instruction == null ? detected : undefined;
  const apply = (item: DetectedEntity): void =>
    importer.mutate(
      { id: item.id },
      {
        onSuccess: (result) => {
          const imported = (result as { entity?: Instruction } | undefined)?.entity;
          if (imported) onOpen(imported, false);
        },
        onError: (err) => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) }),
      },
    );
  const canDelete = instruction != null && copy.removeLabel !== undefined;
  const rowMenu = useRowContextMenu<Instruction>();
  const rowMenuTarget = rowMenu.state?.target;
  // Editar: the Properties modal where there are properties to edit; the personal singleton has none, so it opens its editor.
  const rowMenuActions = rowMenuTarget
    ? toRowActions(
        customizationMenu({
          entity: rowMenuTarget,
          enabled: rowMenuTarget.enabled !== false,
          readOnly: false,
          detected: false,
          canInstallOver: installOver.available,
          hasUndo: false,
          newAction: onNewAction !== undefined,
        }),
        {
          ...(onPreview ? { open: () => onPreview(rowMenuTarget) } : {}),
          edit: kind !== 'personal' && onProperties ? () => onProperties(rowMenuTarget) : () => onOpen(rowMenuTarget, false),
          toggle: () => setEnabled.mutate({ urn: rowMenuTarget.urn, enabled: rowMenuTarget.enabled === false }),
          ...(canDelete ? { delete: () => handleDelete() } : {}),
          installOver: installOver.run,
          ...(onNewAction ? { 'new-action': () => onNewAction(rowMenuTarget) } : {}),
        },
      )
    : [];

  const handleDelete = (): void => {
    if (!instruction || !copy.removeLabel) return;
    const { name, urn } = instruction;
    requestDelete({
      key: urn,
      message: `"${name}" excluído`,
      commit: async () => {
        await callIpc('instruction.delete', { name, removeSymlinks: true });
        await invalidate();
      },
    });
  };

  return (
    <>
      <TreeRow
        testId={rowTestId}
        pl={1.5 + 2.5 + depth * 2}
        glyph={ScrollText}
        primary={item ? <RowLabel item={item} {...(label !== undefined ? { label } : {})} /> : (label ?? copy.label)}
        labelVariant="mono"
        muted={(instruction == null && offered === undefined) || item?.origin === 'global'}
        onClick={() => onOpen(instruction ?? seed(), !instruction)}
        onContextMenu={(e) => {
          if (!instruction) return;
          rowMenu.openMenu(e, instruction);
        }}
        badge={
          instruction ? (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <SessionStatusBadge anchor={{ kind: 'entity', urn: instruction.urn }} />
              {item && <RowBadgeSlot item={item} />}
            </Stack>
          ) : offered ? (
            <DetectedBadge detected={offered} onApply={() => apply(offered)} busy={importer.isPending} />
          ) : undefined
        }
      />
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      {installOver.toast}
    </>
  );
}
