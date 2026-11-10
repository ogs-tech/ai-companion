import { useEffect, useRef } from 'react';
import { ButtonBase, ListItemText, MenuItem } from '@mui/material';
import { X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';

/**
 * Between arming a removal and accepting its confirmation: "Remover" sits where
 * the × just was, so a fast double-click must not count as the second step.
 */
export const FOLDER_REMOVE_CONFIRM_DELAY_MS = 300;

interface WorkspaceFolderRowProps {
  /** Folder basename: the row's label and its testid suffix. */
  name: string;
  /** Only a folder that is not the last one can be removed; otherwise the row is a plain label. */
  removable: boolean;
  /** First click: the row asks "Remover <name>?". */
  armed: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * One folder of the open workspace inside the switcher menu. Removal is two
 * clicks, in place: × (or the row) arms it, then "Remover" confirms. Leaving the
 * row, Esc or closing the menu disarms it.
 */
export function WorkspaceFolderRow({ name, removable, armed, onArm, onCancel, onConfirm }: WorkspaceFolderRowProps): React.ReactElement {
  const armedAt = useRef(0);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!armed) return;
    armedAt.current = Date.now();
    // Safe default: Enter right after arming cancels; the destructive step needs an explicit move.
    cancelRef.current?.focus();
  }, [armed]);

  if (!removable) {
    return (
      <MenuItem data-testid={`context-switcher-folder-${name}`} disableRipple sx={{ cursor: 'default', fontSize: '0.8125rem' }}>
        <ListItemText slotProps={{ primary: { noWrap: true, sx: { fontSize: 'inherit' } } }}>{name}</ListItemText>
      </MenuItem>
    );
  }

  if (armed) {
    return (
      <MenuItem
        component="div"
        data-testid={`context-switcher-folder-${name}`}
        disableRipple
        // Neither a hover nor a focus highlight: the tint below marks the armed row.
        sx={(theme) => ({
          cursor: 'default',
          fontSize: '0.8125rem',
          gap: 1,
          bgcolor: `${theme.palette.error.main}0d`,
          boxShadow: `inset 2px 0 0 ${theme.palette.error.main}`,
          '&:hover, &.Mui-focusVisible': { bgcolor: `${theme.palette.error.main}0d` },
        })}
        onMouseLeave={onCancel}
      >
        <ListItemText slotProps={{ primary: { noWrap: true, sx: { fontSize: 'inherit' } } }}>{`Remover ${name}?`}</ListItemText>
        <ButtonBase
          ref={cancelRef}
          data-testid={`context-switcher-remove-folder-cancel-${name}`}
          onClick={onCancel}
          sx={{ px: 1, py: 0.5, borderRadius: 0.75, fontSize: '0.6875rem', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
        >
          Cancelar
        </ButtonBase>
        <ButtonBase
          data-testid={`context-switcher-remove-folder-confirm-${name}`}
          onClick={() => {
            if (Date.now() - armedAt.current >= FOLDER_REMOVE_CONFIRM_DELAY_MS) onConfirm();
          }}
          sx={(theme) => ({
            px: 1.25,
            py: 0.5,
            borderRadius: 0.75,
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: 'error.dark',
            bgcolor: `${theme.palette.error.main}26`,
            '&:hover': { bgcolor: `${theme.palette.error.main}3d` },
          })}
        >
          Remover
        </ButtonBase>
      </MenuItem>
    );
  }

  return (
    <MenuItem
      data-testid={`context-switcher-remove-folder-${name}`}
      aria-label={`Remover pasta ${name} do workspace`}
      onClick={onArm}
      sx={{
        fontSize: '0.8125rem',
        '& .folder-remove-x': { opacity: 0, color: 'text.secondary' },
        '&:hover .folder-remove-x, &.Mui-focusVisible .folder-remove-x': { opacity: 1 },
      }}
    >
      <ListItemText slotProps={{ primary: { noWrap: true, sx: { fontSize: 'inherit' } } }}>{name}</ListItemText>
      <span className="folder-remove-x" style={{ display: 'inline-flex' }}>
        <Icon glyph={X} size={14} />
      </span>
    </MenuItem>
  );
}
