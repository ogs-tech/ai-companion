import { useState } from 'react';
import { Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import { Eye } from 'lucide-react';
import { Icon } from '../ds/Icon.js';

interface RowContextMenuState<T> {
  mouseX: number;
  mouseY: number;
  target: T;
}

/**
 * Tracks which row (if any) was right-clicked and where, so a tree row only
 * needs to wire its own `onContextMenu` through `openMenu` — the anchor
 * position and the "which row" bookkeeping live here, shared by every tree
 * (FolderTree, EntityTreeGroup, InstructionTreeRow) that offers a row-level
 * right-click menu.
 */
export function useRowContextMenu<T>(): {
  state: RowContextMenuState<T> | null;
  openMenu: (e: React.MouseEvent, target: T) => void;
  closeMenu: () => void;
} {
  const [state, setState] = useState<RowContextMenuState<T> | null>(null);
  return {
    state,
    openMenu: (e, target) => {
      e.preventDefault();
      e.stopPropagation();
      setState({ mouseX: e.clientX, mouseY: e.clientY, target });
    },
    closeMenu: () => setState(null),
  };
}

interface RowContextMenuProps {
  state: { mouseX: number; mouseY: number } | null;
  onClose: () => void;
  onPreview: () => void;
}

/** The menu itself — a single "Preview" action for now, opened at the cursor position from a tree row's right-click. */
export function RowContextMenu({ state, onClose, onPreview }: RowContextMenuProps): React.ReactElement {
  return (
    <Menu
      open={state !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={state ? { top: state.mouseY, left: state.mouseX } : undefined}
    >
      <MenuItem
        data-testid="row-context-menu-preview"
        onClick={() => {
          onClose();
          onPreview();
        }}
      >
        <ListItemIcon><Icon glyph={Eye} size={16} /></ListItemIcon>
        <ListItemText>Preview</ListItemText>
      </MenuItem>
    </Menu>
  );
}
