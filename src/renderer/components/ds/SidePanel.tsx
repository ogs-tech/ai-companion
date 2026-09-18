import type { RefObject } from 'react';
import { Box, Stack } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { Panel, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels';
import { Icon } from './Icon.js';
import { Kicker } from './Kicker.js';

export interface SidePanelProps {
  /** Also becomes this Panel's `data-testid` (react-resizable-panels mirrors `id` onto it), so this is the same value tests query panel identity/`data-collapsed` by. */
  panelId: string;
  panelRef: RefObject<PanelImperativeHandle | null>;
  defaultSize: number | string;
  minSize: number | string;
  maxSize: number | string;
  collapsed: boolean;
  onResize?: (size: PanelSize) => void;
  glyph: LucideIcon;
  title: string;
  /** data-testid on the header block — panel identity, e.g. `workspace-explorer-panel-label`. */
  headerTestId?: string;
  /** Whether the header itself draws the divider below it. Off when the body's own first block (e.g. a breadcrumb) already owns that border. */
  headerDivider?: boolean;
  /** Trailing actions slot on the header's edge, e.g. a refresh button. */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The shared shell for a resizable, collapsible side panel: header (icon +
 * Kicker title + trailing actions) over a scrollable body, wrapping a
 * `react-resizable-panels` `Panel` so every side panel collapses the same
 * way (drag to 0, or via a menu action) instead of each inventing its own
 * mechanism.
 */
export function SidePanel({
  panelId,
  panelRef,
  defaultSize,
  minSize,
  maxSize,
  collapsed,
  onResize,
  glyph,
  title,
  headerTestId,
  headerDivider = true,
  headerActions,
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
      <Box sx={(theme) => ({ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: theme.ogs.surfaces.rail })}>
        <Box
          sx={{ flexShrink: 0, px: 1.5, py: 1, ...(headerDivider ? { borderBottom: 1, borderColor: 'divider' } : {}) }}
          {...(headerTestId ? { 'data-testid': headerTestId } : {})}
        >
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Icon glyph={glyph} size={14} />
            <Kicker>{title}</Kicker>
            {headerActions && (
              <>
                <Box sx={{ flexGrow: 1 }} />
                {headerActions}
              </>
            )}
          </Stack>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {children}
        </Box>
      </Box>
    </Panel>
  );
}
