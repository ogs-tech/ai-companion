import { useState } from 'react';
import { Eye, ScrollText, Settings2, SquareTerminal, Trash2 } from 'lucide-react';
import { TreeRow } from '../ds/TreeRow.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RowMenuButton } from './RowMenuButton.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { useInvalidateInstructions } from '../../hooks/use-instructions.js';
import { ENTITY_ACCENT_COLOR } from '../shell/nav.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import type { Instruction } from '../../../shared/entity.js';

type InstructionRowKind = 'personal' | 'workspace';

const ROW_COPY: Record<InstructionRowKind, { label: string; removeLabel?: (name: string) => string }> = {
  personal: { label: 'instructions' },
  workspace: {
    label: 'instructions',
    removeLabel: (name) => `Remover as instructions deste workspace (${name})?`,
  },
};

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
}

/**
 * A pinned tree-node row for the personal/workspace instruction —
 * sits at the top of a file list (FolderTree, or Início's management list), styled identically to a folder/file row (same icon size,
 * same trailing action-icon treatment) so it reads as one more node rather
 * than a distinct UI concept.
 */
export function InstructionTreeRow({ kind, instruction, seed, onOpen, onPreview, onProperties, onNewAction, testId, label, depth = 0 }: InstructionTreeRowProps): React.ReactElement {
  const copy = ROW_COPY[kind];
  const rowTestId = testId ?? `${kind}-instruction-row`;
  const menuTestId = testId ? `${testId}-menu` : `${kind}-instruction-menu`;
  const invalidate = useInvalidateInstructions();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const canDelete = instruction != null && copy.removeLabel !== undefined;
  const rowMenu = useRowContextMenu<Instruction>();
  const rowMenuTarget = rowMenu.state?.target;
  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget
    ? [
        { key: 'preview', label: 'Preview', glyph: Eye, onSelect: () => onPreview?.(rowMenuTarget) },
        ...(kind !== 'personal'
          ? [{ key: 'properties', label: 'Properties', glyph: Settings2, onSelect: () => onProperties?.(rowMenuTarget) }]
          : []),
        { key: 'new-action', label: 'New Action', glyph: SquareTerminal, onSelect: () => onNewAction?.(rowMenuTarget) },
        ...(canDelete ? [{ key: 'delete', label: 'Remover', glyph: Trash2, danger: true, onSelect: () => void handleDelete() }] : []),
      ]
    : [];

  const handleDelete = async (): Promise<void> => {
    if (!instruction || !copy.removeLabel) return;
    const confirmed = window.confirm(copy.removeLabel(instruction.name));
    if (!confirmed) return;
    try {
      await callIpc('instruction.delete', { name: instruction.name, removeSymlinks: true });
      await invalidate();
      setToast({ variant: 'success', message: 'Instructions removidas' });
    } catch (err) {
      setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
    }
  };

  return (
    <>
      <TreeRow
        testId={rowTestId}
        pl={1.5 + 2.5 + depth * 2}
        glyph={ScrollText}
        primary={label ?? copy.label}
        labelVariant="mono"
        accentColor={ENTITY_ACCENT_COLOR.instruction}
        onClick={() => onOpen(instruction ?? seed(), !instruction)}
        onContextMenu={(e) => {
          if (!instruction) return;
          rowMenu.openMenu(e, instruction);
        }}
        {...(instruction ? { badge: <SessionStatusBadge anchor={{ kind: 'entity', urn: instruction.urn }} /> } : {})}
        {...(instruction
          ? { actions: <RowMenuButton testId={menuTestId} label={`Ações de ${copy.label}`} onOpen={(e) => rowMenu.openMenu(e, instruction)} /> }
          : {})}
      />
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
