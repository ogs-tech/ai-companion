import { Fragment, useRef } from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { TREE_DRAG_TYPE, readTreeDrag } from '../../lib/tree-drag.js';
import { X, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { toneColor, type FileTone } from '../../lib/file-icon.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';

export interface WorkbenchTab {
  id: string;
  glyph: LucideIcon;
  label: string;
  /** Colours the glyph (file-type icons). */
  glyphTone?: FileTone | undefined;
  /** Pinned: shown as its icon alone, on the left behind a divider; the label becomes the tooltip. */
  pinned?: boolean;
  onClose?: () => void;
  /** Verb shown on the close control's tooltip/aria-label — e.g. "Minimizar" for a session tab whose process is still running, vs. "Fechar" once it isn't. Defaults to "Fechar". */
  closeLabel?: string;
  /**
   * Color of the 6px dot before this tab's label, shown whether or not the
   * tab is active — the signature that lets a user trace an open tab back to
   * its row in the side panels (skill/agent/instruction tabs use their
   * kind's role color). Tabs without one show no dot.
   */
  accentColor?: string;
  /** Skips the canvas's own content padding — for tabs (like the entity editor) that manage their own internal spacing edge-to-edge. */
  dense?: boolean;
  /** Unsaved-changes indicator — a small dot next to the label, same signal a `closeTab`/scope-switch discard guard reads to decide whether to confirm. */
  dirty?: boolean;
  /**
   * Path-like context for this tab, browser-address-bar style (e.g.
   * "brand › INSTRUCTIONS", "apps › src › a.md") — shown only while this tab
   * is active. A tab's own label is often just the scope's name (an
   * instruction's `entity.name` is its project/workspace's own basename), so
   * two unrelated tabs can carry the exact same label; the breadcrumb is what
   * actually disambiguates them. Omitted for tabs with no real path (a
   * session, a preview, Histórico).
   */
  breadcrumb?: string;
  /** Renders the glyph alone — the label becomes the tooltip and aria-label. For the pinned "Visão geral" tab. */
  iconOnly?: boolean;
  /** Rendered for every open tab on every render, not just the active one — visibility is a `display` toggle (via the `hidden` arg), never a mount/unmount, so scroll position survives switching away and back. */
  render: (hidden: boolean) => React.ReactNode;
}

function TabGlyph({ tab }: { tab: WorkbenchTab }): React.ReactElement {
  return (
    <Box component="span" sx={(theme) => ({ display: 'inline-flex', color: toneColor(theme, tab.glyphTone) ?? 'inherit' })}>
      <Icon glyph={tab.glyph} size={14} />
    </Box>
  );
}

interface WorkbenchCanvasProps {
  tabs: readonly WorkbenchTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  /** Drag a tab onto another to reorder. */
  onReorder?: (fromId: string, toId: string) => void;
  /** Right-click menu for a tab; omitted or empty means no menu. */
  tabMenu?: (tab: WorkbenchTab) => RowContextMenuAction[];
  /** Files dropped on the editor area: OS files (absolute paths via `getPathForFile`) or tree paths. */
  onDropFiles?: (drop: { files: File[]; treePaths: string[] }) => void;
}

/**
 * The Sublime-like editing surface to the right of the Workspace tree — every
 * open file AND every open Skill/Agent/Instruction tab lives here, all
 * rendered through the same EditorPanel; sessions share the tab strip too.
 */
export function WorkbenchCanvas({ tabs, activeTabId, onSelect, onReorder, tabMenu, onDropFiles }: WorkbenchCanvasProps): React.ReactElement {
  const menu = useRowContextMenu<WorkbenchTab>();
  const dragId = useRef<string | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  return (
    <Box data-testid="workbench-canvas" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      {tabs.length > 0 && (
        <Stack
          direction="row"
          data-testid="workbench-tabs"
          sx={{ px: 1, py: 0.75, gap: 0.375, borderBottom: 1, borderColor: 'divider', overflowX: 'auto', flexShrink: 0 }}
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const compact = tab.iconOnly === true || tab.pinned === true;
            const lastPinned = tab.pinned === true && !tabs[tabs.indexOf(tab) + 1]?.pinned;
            return (
              <Fragment key={tab.id}>
              <Tooltip title={tab.iconOnly || tab.pinned ? tab.label : ''}>
                <Box
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={tab.dirty ? `${tab.label} (não salvo)` : tab.label}
                  data-testid={`workbench-tab-${tab.id}`}
                  onClick={() => onSelect(tab.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1 && tab.onClose) {
                      e.preventDefault();
                      tab.onClose();
                    }
                  }}
                  onContextMenu={(e) => {
                    if ((tabMenu?.(tab).length ?? 0) > 0) menu.openMenu(e, tab);
                  }}
                  draggable={onReorder !== undefined && !tab.iconOnly}
                  onDragStart={(e) => {
                    dragId.current = tab.id;
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (dragId.current !== null && dragId.current !== tab.id) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (dragId.current === null) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onReorder?.(dragId.current, tab.id);
                    dragId.current = null;
                  }}
                  onDragEnd={() => {
                    dragId.current = null;
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    if (e.key === ' ') e.preventDefault();
                    onSelect(tab.id);
                  }}
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    borderRadius: `${theme.ogs.radius.pill}px`,
                    color: active ? 'text.primary' : 'text.secondary',
                    bgcolor: active ? theme.ogs.surfaces.rail : 'transparent',
                    flexShrink: 0,
                    '&:hover': active ? {} : { bgcolor: 'action.hover' },
                    '&:hover .workbench-tab-close, &:focus-within .workbench-tab-close': { color: 'text.secondary', display: 'inline-flex' },
                    '&:hover .workbench-tab-dirty, &:focus-within .workbench-tab-dirty': { display: tab.onClose && !tab.pinned ? 'none' : undefined },
                  })}
                >
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', pl: compact ? 1 : 1.25, pr: tab.onClose && !tab.pinned ? 0.5 : compact ? 1 : 1.25, py: 0.25, minHeight: 24 }}>
                    {compact ? (
                      <TabGlyph tab={tab} />
                    ) : tab.accentColor ? (
                      <Box
                        aria-hidden
                        sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: tab.accentColor, flexShrink: 0 }}
                      />
                    ) : (
                      <TabGlyph tab={tab} />
                    )}
                    {!compact && (
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: active ? 500 : 400, maxWidth: 160 }}>
                        {tab.label}
                      </Typography>
                    )}
                    {tab.dirty && (
                      <Box
                        className="workbench-tab-dirty"
                        data-testid={`workbench-tab-dirty-${tab.id}`}
                        aria-hidden
                        sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0, mr: tab.pinned ? 0 : 0.5 }}
                      />
                    )}
                    {tab.onClose && !tab.pinned && (
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
                        className="workbench-tab-close"
                        sx={(theme) => ({
                          // A dirty tab shows its dot in the close button's place until hovered.
                          display: tab.dirty ? 'none' : 'inline-flex',
                          p: 0.5,
                          ml: 0.25,
                          borderRadius: `${theme.ogs.radius.pill}px`,
                          color: 'text.disabled',
                          '&:hover': { bgcolor: 'action.hover' },
                        })}
                      >
                        <Icon glyph={X} size={12} />
                      </Box>
                    )}
                  </Stack>
                </Box>
              </Tooltip>
              {lastPinned && <Box aria-hidden data-testid="workbench-pinned-divider" sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', mx: 0.5, flexShrink: 0 }} />}
              </Fragment>
            );
          })}
        </Stack>
      )}
      {activeTab?.breadcrumb && (
        <Box
          data-testid="workbench-breadcrumb"
          sx={(theme) => ({
            px: 1.5,
            py: 0.5,
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
            flexShrink: 0,
            fontFamily: theme.ogs.fonts.mono,
            fontSize: '0.75rem',
            color: 'text.secondary',
          })}
        >
          {activeTab.breadcrumb}
        </Box>
      )}
      <RowContextMenu state={menu.state} onClose={menu.closeMenu} actions={menu.state ? (tabMenu?.(menu.state.target) ?? []) : []} />
      <Box
        sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        onDragOver={(e) => {
          if (onDropFiles && dragId.current === null && (Array.from(e.dataTransfer.types).includes('Files') || Array.from(e.dataTransfer.types).includes(TREE_DRAG_TYPE))) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!onDropFiles || dragId.current !== null) return;
          const treePaths = readTreeDrag(e.dataTransfer);
          const files = Array.from(e.dataTransfer.files);
          if (treePaths.length === 0 && files.length === 0) return;
          e.preventDefault();
          onDropFiles({ files, treePaths });
        }}
      >
        {tabs.map((tab) => (
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
