import type { RefObject } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import { Panel, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels';

export interface SidePanelProps {
  /** Also becomes this Panel's `data-testid` (react-resizable-panels mirrors `id` onto it), so this is the same value tests query panel identity/`data-collapsed` by. */
  panelId: string;
  panelRef: RefObject<PanelImperativeHandle | null>;
  defaultSize: number | string;
  minSize: number | string;
  maxSize: number | string;
  collapsed: boolean;
  onResize?: (size: PanelSize) => void;
  /** data-testid on the card itself — panel identity, e.g. `workspace-explorer-panel-label`. */
  cardTestId?: string;
  children: React.ReactNode;
}

/**
 * A workspace panel's card: `paper` surface, hairline border, `radius.md`,
 * no shadow — the `canvas` shows in the gaps between cards. Shared by the
 * side panels and the Workbench so all three read as one system.
 */
export function panelCardSx(collapsed = false): SxProps<Theme> {
  return (theme) => ({
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    bgcolor: 'background.paper',
    // A collapsed card must not leave a stray hairline behind in the gap.
    border: collapsed ? 'none' : `1px solid ${theme.palette.divider}`,
    borderRadius: `${theme.ogs.radius.md}px`,
    overflow: 'hidden',
  });
}

/**
 * The shared shell for a resizable, collapsible side panel: a card with a
 * scrollable body, wrapping a `react-resizable-panels` `Panel` so every side
 * panel collapses the same way (drag to 0, or via a menu action) instead of
 * each inventing its own mechanism.
 */
export function SidePanel({
  panelId,
  panelRef,
  defaultSize,
  minSize,
  maxSize,
  collapsed,
  onResize,
  cardTestId,
  children,
}: SidePanelProps): React.ReactElement {
  return (
    <Panel
      id={panelId}
      panelRef={panelRef}
      collapsible
      collapsedSize="0"
      defaultSize={defaultSize}
      minSize={minSize}
      maxSize={maxSize}
      {...(onResize ? { onResize } : {})}
      style={{ overflow: 'hidden' }}
      data-collapsed={collapsed}
    >
      <Box sx={panelCardSx(collapsed)} {...(cardTestId ? { 'data-testid': cardTestId } : {})}>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {children}
        </Box>
      </Box>
    </Panel>
  );
}
