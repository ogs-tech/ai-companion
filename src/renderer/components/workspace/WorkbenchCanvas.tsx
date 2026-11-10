import { keyframes } from '@mui/material';
import { SessionStateMark } from '../SessionStateMark.js';
import { FILTER_LABELS } from '../../lib/session-attention.js';
import type { SessionRowState } from '../../lib/session-attention.js';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { TREE_DRAG_TYPE, readTreeDrag } from '../../lib/tree-drag.js';
import { ChevronDown, Plus, X, type LucideIcon } from 'lucide-react';
import { PANEL_HEADER_HEIGHT } from '../ds/ContainerChrome.js';
import { Icon } from '../ds/Icon.js';
import { toneColor, type FileTone } from '../../lib/file-icon.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';

const BREADCRUMB_HEIGHT = 26;

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
  /** A session tab's live state: shown as the four-state mark beside the label. */
  sessionState?: SessionRowState;
  /** What that state is about ("Edit · 12 s", "Permissão: Bash") — appended to the state name in the tab's tooltip. */
  sessionDetail?: string;
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

/** One soft ring per 2 s on an inactive tab that is waiting on the user — the only state that asks for you. */
const attentionRing = keyframes`0% { opacity: 0.7; transform: scale(0.96); } 70%, 100% { opacity: 0; transform: scale(1.04); }`;

function tabTooltip(tab: WorkbenchTab): string {
  if (tab.sessionState) return tab.sessionDetail ? `${FILTER_LABELS[tab.sessionState]} — ${tab.sessionDetail}` : FILTER_LABELS[tab.sessionState];
  return tab.iconOnly || tab.pinned ? tab.label : '';
}

function TabGlyph({ tab }: { tab: WorkbenchTab }): React.ReactElement {
  return (
    <Box component="span" sx={(theme) => ({ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: toneColor(theme, tab.glyphTone) ?? 'inherit' })}>
      <Icon glyph={tab.glyph} size={14} />
      {tab.sessionState && <SessionStateMark state={tab.sessionState} testId={`workbench-tab-state-${tab.id}`} />}
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
  /** Creation shortcuts behind the strip's trailing "+" (Nova sessão, Novo terminal…); omitted or empty hides the button. */
  newMenu?: readonly RowContextMenuAction[];
  /** Files dropped on the editor area: OS files (absolute paths via `getPathForFile`) or tree paths. */
  onDropFiles?: (drop: { files: File[]; treePaths: string[] }) => void;
}

/**
 * The Sublime-like editing surface to the right of the Workspace tree — every
 * open file AND every open Skill/Agent/Instruction tab lives here, all
 * rendered through the same EditorPanel; sessions share the tab strip too.
 */
export function WorkbenchCanvas({ tabs, activeTabId, onSelect, onReorder, tabMenu, newMenu, onDropFiles }: WorkbenchCanvasProps): React.ReactElement {
  const menu = useRowContextMenu<WorkbenchTab>();
  const dragId = useRef<string | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const [newAnchor, setNewAnchor] = useState<HTMLElement | null>(null);
  const hasNewMenu = (newMenu?.length ?? 0) > 0;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [allAnchor, setAllAnchor] = useState<HTMLElement | null>(null);

  // The strip scrolls, so the active tab must never sit out of sight.
  useEffect(() => {
    if (activeTabId === null) return;
    const el = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []).find((node) => node.dataset.tabId === activeTabId);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  // Offer "all tabs" only when some are actually hidden.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = (): void => setOverflowing(strip.scrollWidth > strip.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [tabs]);
  return (
    <Box data-testid="workbench-canvas" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      {(tabs.length > 0 || hasNewMenu) && (
        <Stack
          direction="row"
          sx={{ height: PANEL_HEADER_HEIGHT, boxSizing: 'border-box', alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
        >
        <Stack
          ref={stripRef}
          direction="row"
          data-testid="workbench-tabs"
          sx={{ pl: 1, pr: 0.5, height: '100%', flex: 1, minWidth: 0, alignItems: 'center', gap: 0.375, overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const compact = tab.iconOnly === true || tab.pinned === true;
            const lastPinned = tab.pinned === true && !tabs[tabs.indexOf(tab) + 1]?.pinned;
            return (
              <Fragment key={tab.id}>
              <Tooltip title={tabTooltip(tab)}>
                <Box
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={tab.dirty ? `${tab.label} (não salvo)` : tab.label}
                  data-testid={`workbench-tab-${tab.id}`}
                  data-tab-id={tab.id}
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
                    position: 'relative',
                    cursor: 'pointer',
                    borderRadius: `${theme.ogs.radius.pill}px`,
                    color: active ? 'text.primary' : 'text.secondary',
                    bgcolor: active ? theme.ogs.surfaces.rail : 'transparent',
                    // A closed session's tab recedes; it stays reachable.
                    opacity: tab.sessionState === 'exited' && !active ? 0.6 : 1,
                    flexShrink: 0,
                    '@media (prefers-reduced-motion: no-preference)': {
                      transition: 'background-color 0.2s ease, color 0.2s ease, opacity 0.25s ease',
                      ...(tab.sessionState === 'needs-input' && !active
                        ? {
                            '&::before': {
                              content: '""',
                              position: 'absolute',
                              inset: 0,
                              borderRadius: 'inherit',
                              border: `1px solid ${theme.palette.warning.main}`,
                              pointerEvents: 'none',
                              animation: `${attentionRing} 2s ease-out infinite`,
                            },
                          }
                        : {}),
                    },
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
        <Stack direction="row" sx={{ flex: 'none', alignItems: 'center', gap: 0.25, pl: 0.5, pr: 1 }}>
          {overflowing && (
            <Tooltip title="Todas as abas">
              <IconButton
                size="small"
                data-testid="workbench-all-tabs"
                aria-label="Todas as abas"
                aria-haspopup="menu"
                onClick={(e) => setAllAnchor(e.currentTarget)}
                sx={{ p: 0.5, color: 'text.secondary', gap: 0.25, borderRadius: 1 }}
              >
                <Icon glyph={ChevronDown} size={14} />
                <Typography component="span" sx={{ fontSize: '0.7rem' }}>{tabs.length}</Typography>
              </IconButton>
            </Tooltip>
          )}
          {hasNewMenu && (
            <Tooltip title="Novo…">
              <IconButton
                size="small"
                data-testid="workbench-new"
                aria-label="Novo…"
                aria-haspopup="menu"
                onClick={(e) => setNewAnchor(e.currentTarget)}
                sx={{ p: 0.5, flexShrink: 0, color: 'text.secondary' }}
              >
                <Icon glyph={Plus} size={14} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        </Stack>
      )}
      <Menu open={allAnchor !== null} anchorEl={allAnchor} onClose={() => setAllAnchor(null)}>
        {tabs.map((tab) => (
          <MenuItem
            key={tab.id}
            selected={tab.id === activeTabId}
            data-testid={`workbench-all-tabs-${tab.id}`}
            onClick={() => {
              setAllAnchor(null);
              onSelect(tab.id);
            }}
          >
            <ListItemIcon><Icon glyph={tab.glyph} size={14} /></ListItemIcon>
            <ListItemText primary={tab.label} />
          </MenuItem>
        ))}
      </Menu>
      <Menu open={newAnchor !== null} anchorEl={newAnchor} onClose={() => setNewAnchor(null)}>
        {(newMenu ?? []).map((action) => (
          <MenuItem
            key={action.key}
            data-testid={`workbench-new-${action.key}`}
            onClick={() => {
              setNewAnchor(null);
              action.onSelect(newAnchor as HTMLElement);
            }}
          >
            <ListItemIcon><Icon glyph={action.glyph} size={14} /></ListItemIcon>
            <ListItemText primary={action.label} />
            {action.shortcut !== undefined && (
              <Typography component="span" variant="caption" sx={{ ml: 3, color: 'text.secondary' }}>{action.shortcut}</Typography>
            )}
          </MenuItem>
        ))}
      </Menu>
      {/* The row is always there, so content does not jump between tabs with and without a path. */}
      {tabs.length > 0 && (
        <Box
          data-testid="workbench-breadcrumb"
          sx={(theme) => ({
            px: 1.5,
            height: BREADCRUMB_HEIGHT,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
            flexShrink: 0,
            fontFamily: theme.ogs.fonts.mono,
            fontSize: '0.75rem',
            color: 'text.secondary',
          })}
        >
          {activeTab?.breadcrumb}
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
