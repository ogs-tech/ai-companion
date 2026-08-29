import { Box, Stack, Typography } from '@mui/material';
import { X, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';

export interface WorkbenchTab {
  id: string;
  glyph: LucideIcon;
  label: string;
  onClose?: () => void;
  /** Verb shown on the close control's tooltip/aria-label — e.g. "Minimizar" for a session tab whose process is still running, vs. "Fechar" once it isn't. Defaults to "Fechar". */
  closeLabel?: string;
  /**
   * Top-border color for this tab when active — the signature that lets a
   * user trace an open tab back to its row in the rail (skill/agent/
   * instruction tabs use their kind's role color; falls back to
   * `secondary.main`, the same neutral used for file tabs).
   */
  accentColor?: string;
  /** Skips the canvas's own content padding — for tabs (like the entity editor) that manage their own internal spacing edge-to-edge. */
  dense?: boolean;
  /** Unsaved-changes indicator — a small dot next to the label, same signal a `closeTab`/scope-switch discard guard reads to decide whether to confirm. */
  dirty?: boolean;
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
 * The Sublime-like editing surface to the right of the Workspace tree — every
 * open file AND every open Skill/Agent/Instruction tab lives here, all
 * rendered through the same EditorPanel; sessions share the tab strip too.
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
                aria-label={tab.dirty ? `${tab.label} (não salvo)` : tab.label}
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
                  borderTopColor: active ? (tab.accentColor ?? 'secondary.main') : 'transparent',
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
                  {tab.dirty && (
                    <Box
                      data-testid={`workbench-tab-dirty-${tab.id}`}
                      aria-hidden
                      sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }}
                    />
                  )}
                  {tab.onClose && (
                    <Box
                      component="span"
                      role="button"
                      tabIndex={0}
                      aria-label={`${tab.closeLabel ?? 'Fechar'} ${tab.label}`}
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
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tabs.length === 0
          ? emptyState
          : tabs.map((tab) => (
              <Box
                key={tab.id}
                sx={{ display: tab.id === activeTabId ? 'block' : 'none', height: '100%', p: tab.dense ? 0 : 2 }}
              >
                {tab.render(tab.id !== activeTabId)}
              </Box>
            ))}
      </Box>
    </Box>
  );
}
