import { useState } from 'react';
import { Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
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

export interface RowContextMenuAction {
  key: string;
  label: string;
  glyph: LucideIcon;
  onSelect: () => void;
}

interface RowContextMenuProps {
  state: { mouseX: number; mouseY: number } | null;
  onClose: () => void;
  /** One entry per action a row offers — e.g. Preview, Properties. Empty/omitted rows simply don't call `openMenu` in the first place. */
  actions: readonly RowContextMenuAction[];
}

/** The menu itself, opened at the cursor position from a tree row's right-click. */
export function RowContextMenu({ state, onClose, actions }: RowContextMenuProps): React.ReactElement {
  return (
    <Menu
      open={state !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={state ? { top: state.mouseY, left: state.mouseX } : undefined}
    >
      {actions.map((action) => (
        <MenuItem
          key={action.key}
          data-testid={`row-context-menu-${action.key}`}
          onClick={() => {
            onClose();
            action.onSelect();
          }}
        >
          <ListItemIcon><Icon glyph={action.glyph} size={16} /></ListItemIcon>
          <ListItemText>{action.label}</ListItemText>
        </MenuItem>
      ))}
    </Menu>
  );
}
