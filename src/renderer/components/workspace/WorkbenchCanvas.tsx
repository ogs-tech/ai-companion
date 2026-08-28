import { Box, Stack, Typography } from '@mui/material';
import { X, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';

export interface WorkbenchTab {
  id: string;
  glyph: LucideIcon;
  label: string;
  onClose?: () => void;
  /** Rendered for every open tab on every render, not just the active one — visibility is a `display` toggle (via the `hidden` arg), never a mount/unmount, so scroll position survives switching away and back. */
  render: (hidden: boolean) => React.ReactNode;
}

interface WorkbenchCanvasProps {
  tabs: readonly WorkbenchTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  emptyState: React.ReactNode;
}

/**
 * The file-editing surface to the right of the Workspace tree — every open
 * file is a tab here. Skills/Agents/Instructions/Hooks/MCP/Plugins are
 * Customizations, not files, and open in their own dialog instead (see
 * WorkspaceScreen's entityDialog) — this canvas stays file-only.
 */
export function WorkbenchCanvas({ tabs, activeTabId, onSelect, emptyState }: WorkbenchCanvasProps): React.ReactElement {
  return (
    <Box data-testid="workbench-canvas" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      {tabs.length > 0 && (
        <Stack direction="row" data-testid="workbench-tabs" sx={{ borderBottom: 1, borderColor: 'divider', overflowX: 'auto', flexShrink: 0 }}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <Box
                key={tab.id}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={tab.label}
                data-testid={`workbench-tab-${tab.id}`}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  if (e.key === ' ') e.preventDefault();
                  onSelect(tab.id);
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderRight: 1,
                  borderTop: 2,
                  borderTopColor: active ? 'secondary.main' : 'transparent',
                  borderColor: active ? undefined : 'divider',
                  bgcolor: active ? 'background.paper' : 'transparent',
                  flexShrink: 0,
                }}
              >
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', pl: 1.25, pr: tab.onClose ? 0.5 : 1.25, py: 0.875 }}>
                  <Icon glyph={tab.glyph} size={14} />
                  <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: active ? 600 : 400, maxWidth: 160 }}>
                    {tab.label}
                  </Typography>
                  {tab.onClose && (
                    <Box
                      component="span"
                      role="button"
                      tabIndex={0}
                      aria-label={`Fechar ${tab.label}`}
                      data-testid={`workbench-tab-close-${tab.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        tab.onClose?.();
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        if (e.key === ' ') e.preventDefault();
                        e.stopPropagation();
                        tab.onClose?.();
                      }}
                      sx={{ display: 'inline-flex', p: 0.5, ml: 0.25, borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <Icon glyph={X} size={12} />
                    </Box>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: tabs.length > 0 ? 2 : 0 }}>
        {tabs.length === 0
          ? emptyState
          : tabs.map((tab) => (
              <Box key={tab.id} sx={{ display: tab.id === activeTabId ? 'block' : 'none', height: '100%' }}>
                {tab.render(tab.id !== activeTabId)}
              </Box>
            ))}
      </Box>
    </Box>
  );
}
