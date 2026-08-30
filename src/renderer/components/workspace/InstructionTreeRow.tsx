import { useState } from 'react';
import { Box, ListItemButton, ListItemText, Stack, Tooltip } from '@mui/material';
import { Eye, Globe, NotebookPen, Settings2, SquareTerminal, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { useInvalidateInstructions, useProjectInstruction } from '../../hooks/use-instructions.js';
import { ENTITY_ACCENT_COLOR } from '../shell/nav.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import { seedProjectInstruction } from '../../lib/instruction-seed.js';
import type { Instruction } from '../../../shared/entity.js';
import type { Project } from '../../../shared/project.js';

type InstructionRowKind = 'personal' | 'workspace' | 'project';

const ROW_COPY: Record<InstructionRowKind, { label: string; glyph: LucideIcon; removeLabel?: (name: string) => string }> = {
  personal: { label: 'INSTRUCTIONS', glyph: Globe },
  workspace: {
    label: 'INSTRUCTIONS',
    glyph: NotebookPen,
    removeLabel: (name) => `Remover as instructions deste workspace (${name})?`,
  },
  project: {
    label: 'INSTRUCTIONS',
    glyph: NotebookPen,
    removeLabel: (name) => `Remover as instructions deste projeto (${name})?`,
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
  /** Overrides the default `data-testid` (`${kind}-instruction-row`) — needed when several `kind="project"` rows for different projects can be mounted at once (one per expanded folder), so each needs its own unique id. */
  testId?: string;
  /** Tree nesting level, matching `FolderTree`'s `TreeNode` indent formula (`pl: 1.5 + depth * 2`) — lets a row pinned inside a folder node (e.g. a Project's own INSTRUCTIONS) line up with its sibling files/folders instead of sitting flush with its parent. Defaults to `0` (top-level, unindented). */
  depth?: number;
}

/**
 * A pinned tree-node row for the personal/workspace/project instruction —
 * sits at the top of a file list (FolderTree, or the Global workspace's
 * management list), styled identically to a folder/file row (same icon size,
 * same trailing action-icon treatment) so it reads as one more node rather
 * than a distinct UI concept.
 */
export function InstructionTreeRow({ kind, instruction, seed, onOpen, onPreview, onProperties, onNewAction, testId, depth = 0 }: InstructionTreeRowProps): React.ReactElement {
  const copy = ROW_COPY[kind];
  const rowTestId = testId ?? `${kind}-instruction-row`;
  const deleteTestId = testId ? `${testId}-delete` : `${kind}-instruction-delete`;
  const invalidate = useInvalidateInstructions();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Instruction>();
  const rowMenuTarget = rowMenu.state?.target;
  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget
    ? [
        { key: 'preview', label: 'Preview', glyph: Eye, onSelect: () => onPreview?.(rowMenuTarget) },
        ...(kind !== 'personal'
          ? [{ key: 'properties', label: 'Properties', glyph: Settings2, onSelect: () => onProperties?.(rowMenuTarget) }]
          : []),
        { key: 'new-action', label: 'New Action', glyph: SquareTerminal, onSelect: () => onNewAction?.(rowMenuTarget) },
      ]
    : [];
  const configured = instruction != null;
  const canDelete = configured && copy.removeLabel !== undefined;

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
      <ListItemButton
        dense
        data-testid={rowTestId}
        onClick={() => onOpen(instruction ?? seed(), !instruction)}
        onContextMenu={(e) => {
          if (!instruction) return;
          rowMenu.openMenu(e, instruction);
        }}
        sx={{
          pl: 1.5 + depth * 2,
          position: 'relative',
          '&:hover .instruction-row-actions, &:focus-within .instruction-row-actions': { opacity: 1 },
        }}
      >
        <Box
          sx={(theme) => ({
            position: 'absolute', left: 0, top: 4, bottom: 4, width: 3,
            borderRadius: `${theme.ogs.radius.xs}px`, bgcolor: ENTITY_ACCENT_COLOR.instruction,
          })}
        />
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
          <Icon glyph={copy.glyph} size={14} />
          <ListItemText primary={copy.label} slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }} />
          {instruction && <SessionStatusBadge anchor={{ kind: 'entity', urn: instruction.urn }} />}
        </Stack>
        {canDelete && (
          <Box className="instruction-row-actions" sx={{ display: 'flex', alignItems: 'center', opacity: 0, transition: 'opacity 120ms ease' }}>
            <Tooltip title="Remover">
              <Box
                component="span"
                role="button"
                tabIndex={0}
                aria-label={`Remover ${copy.label}`}
                data-testid={deleteTestId}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete();
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  if (e.key === ' ') e.preventDefault();
                  e.stopPropagation();
                  void handleDelete();
                }}
                sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
              >
                <Icon glyph={Trash2} size={14} />
              </Box>
            </Tooltip>
          </Box>
        )}
      </ListItemButton>
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

interface ProjectInstructionRowProps {
  project: Project;
  onOpen: (entity: Instruction, isCreate: boolean) => void;
  /** See `InstructionTreeRowProps.onPreview`. */
  onPreview?: (entity: Instruction) => void;
  /** See `InstructionTreeRowProps.onProperties`. */
  onProperties?: (entity: Instruction) => void;
  /** See `InstructionTreeRowProps.onNewAction`. */
  onNewAction?: (entity: Instruction) => void;
  /** See `InstructionTreeRowProps.testId` — pass a per-project id whenever more than one of these can be mounted at once (e.g. several Project folders expanded in the same tree). */
  testId?: string;
  /** See `InstructionTreeRowProps.depth`. */
  depth?: number;
}

/**
 * Owns the `useProjectInstruction` query for one specific Project, so it can
 * be mounted once per Project folder — every instance narrows the same
 * shared `instruction.list` cache (see `useScopedInstruction`), so having
 * several on screen at once costs no extra fetches.
 */
export function ProjectInstructionRow({ project, onOpen, onPreview, onProperties, onNewAction, testId, depth }: ProjectInstructionRowProps): React.ReactElement {
  const { data: projectInstruction } = useProjectInstruction(project.id);
  return (
    <InstructionTreeRow
      kind="project"
      instruction={projectInstruction}
      seed={() => seedProjectInstruction(project)}
      onOpen={onOpen}
      {...(onPreview ? { onPreview } : {})}
      {...(onProperties ? { onProperties } : {})}
      {...(onNewAction ? { onNewAction } : {})}
      {...(testId ? { testId } : {})}
      {...(depth !== undefined ? { depth } : {})}
    />
  );
}
