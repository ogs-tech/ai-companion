import { IconButton, Tooltip } from '@mui/material';
import { MoreHorizontal } from 'lucide-react';
import { Icon } from '../ds/Icon.js';

interface RowMenuButtonProps {
  testId: string;
  label: string;
  /** Opens the row's menu — receives the click so `useRowContextMenu().openMenu` can anchor at the cursor. */
  onOpen: (e: React.MouseEvent) => void;
}

/** The "⋯" a tree row reveals on hover; one menu replaces the row's loose switch/edit/delete icons. */
export function RowMenuButton({ testId, label, onOpen }: RowMenuButtonProps): React.ReactElement {
  return (
    <Tooltip title="Ações">
      <IconButton size="small" data-testid={testId} aria-label={label} onClick={onOpen} sx={{ p: 0.25 }}>
        <Icon glyph={MoreHorizontal} size={14} />
      </IconButton>
    </Tooltip>
  );
}
