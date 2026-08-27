import { useState } from 'react';
import { Box, ListItemButton, ListItemText, Stack, Tooltip } from '@mui/material';
import { Globe, NotebookPen, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { useInvalidateInstructions } from '../../hooks/use-instructions.js';
import type { Instruction } from '../../../shared/entity.js';

type InstructionRowKind = 'personal' | 'workspace' | 'project';

const ROW_COPY: Record<InstructionRowKind, { label: string; glyph: LucideIcon; removeLabel?: (name: string) => string }> = {
  personal: { label: 'Personal Instruction', glyph: Globe },
  workspace: {
    label: 'Instructions do workspace',
    glyph: NotebookPen,
    removeLabel: (name) => `Remover as instructions deste workspace (${name})?`,
  },
  project: {
    label: 'Instructions do projeto',
    glyph: NotebookPen,
    removeLabel: (name) => `Remover as instructions deste projeto (${name})?`,
  },
};

interface InstructionTreeRowProps {
  kind: InstructionRowKind;
  instruction: Instruction | null | undefined;
  seed: () => Instruction;
  onOpen: (entity: Instruction, isCreate: boolean) => void;
}

/**
 * A pinned tree-node row for the personal/workspace/project instruction —
 * sits at the top of a file list (FolderTree, or the Global workspace's
 * management list), styled identically to a folder/file row (same icon size,
 * same trailing action-icon treatment) so it reads as one more node rather
 * than a distinct UI concept.
 */
export function InstructionTreeRow({ kind, instruction, seed, onOpen }: InstructionTreeRowProps): React.ReactElement {
  const copy = ROW_COPY[kind];
  const invalidate = useInvalidateInstructions();
  const [toast, setToast] = useState<ToastMessage | null>(null);
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
        data-testid={`${kind}-instruction-row`}
        onClick={() => onOpen(instruction ?? seed(), !instruction)}
        sx={{ pl: 1.5 }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
          <Icon glyph={copy.glyph} size={14} />
          <ListItemText primary={copy.label} slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }} />
        </Stack>
        {canDelete && (
          <Tooltip title="Remover">
            <Box
              component="span"
              role="button"
              tabIndex={0}
              aria-label={`Remover ${copy.label}`}
              data-testid={`${kind}-instruction-delete`}
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
        )}
      </ListItemButton>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
