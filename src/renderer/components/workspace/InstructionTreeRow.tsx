import { Box } from '@mui/material';
import { useState } from 'react';
import { Download, ScrollText } from 'lucide-react';
import { TreeRow } from '../ds/TreeRow.js';
import { RowMenuButton } from './RowMenuButton.js';
import { treeIndent } from './TreeGroup.js';
import { RowLabel, RowSignal, useInstallOver } from './RowBadgeSlot.js';
import type { TreeItem } from '../../lib/customization-tree.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
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
  personal: { label: 'Instruções' },
  workspace: {
    label: 'Instruções',
    removeLabel: (name) => `Remover as instruções deste workspace (${name})?`,
  },
  folder: {
    label: 'Instruções',
    removeLabel: (name) => `Remover as instruções desta pasta (${name})?`,
  },
};

/** The detected file's name at the end of the row; importing it is the row menu's first item. */
function DetectedFile({ detected }: { detected: DetectedEntity }): React.ReactElement {
  return (
    <Box
      component="span"
      data-testid="detected-file"
      sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.6875rem', color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 })}
    >
      {String(detected.preview['file'] ?? detected.description)}
    </Box>
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
  // While the level has no instruction, the file found there is offered: the row recedes and its menu imports it.
  const offeredMenu = useRowContextMenu<DetectedEntity>();
  const offeredActions: RowContextMenuAction[] =
    offeredMenu.state && offered
      ? toRowActions(
          customizationMenu({ entity: { kind: 'instruction', name: offered.name, scopes: ['personal'] }, enabled: true, readOnly: false, detected: true, canInstallOver: false, hasUndo: false, newAction: false }),
          { import: () => apply(offered) },
        ).map((a) => (a.key === 'import' ? { ...a, glyph: Download, label: `Importar ${String(offered.preview['file'] ?? 'arquivo detectado')}` } : a))
      : [];
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
        pl={treeIndent(depth)}
        glyph={ScrollText}
        primary={item ? <RowLabel item={item} {...(label !== undefined ? { label } : {})} /> : (label ?? copy.label)}
        labelVariant="item"
        density="comfortable"
        mutedStyle={offered ? 'recede' : 'quiet'}
        muted={instruction == null}
        onClick={() => onOpen(instruction ?? seed(), !instruction)}
        onContextMenu={(e) => {
          if (instruction) rowMenu.openMenu(e, instruction);
          else if (offered) offeredMenu.openMenu(e, offered);
        }}
        {...(instruction
          ? { actions: <RowMenuButton testId={`row-actions-${rowTestId}-btn`} label="Ações" onOpen={(e) => rowMenu.openMenu(e, instruction)} /> }
          : offered
            ? { actions: <RowMenuButton testId={`row-actions-${rowTestId}-btn`} label="Ações" onOpen={(e) => offeredMenu.openMenu(e, offered)} /> }
            : {})}
        badge={
          instruction ? (
            item ? <RowSignal item={item} anchorUrn={instruction.urn} /> : <SessionStatusBadge anchor={{ kind: 'entity', urn: instruction.urn }} />
          ) : offered ? (
            <DetectedFile detected={offered} />
          ) : undefined
        }
      />
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <RowContextMenu state={offeredMenu.state} onClose={offeredMenu.closeMenu} actions={offeredActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      {installOver.toast}
    </>
  );
}
