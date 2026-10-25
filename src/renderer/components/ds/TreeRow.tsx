import { Box, ListItemButton, ListItemText, Stack, alpha, type SxProps, type Theme } from '@mui/material';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { Icon } from './Icon.js';

export interface TreeRowProps {
  testId?: string;
  /** Left padding (theme spacing units) — callers compute their own indent (depth-based for a file tree, fixed for a group's entity rows). */
  pl: number;
  /**
   * 'expanded'/'collapsed' render an actual chevron; 'spacer' reserves the
   * same width with nothing in it, so a row that can't expand still lines up
   * with sibling rows that can; omitted entirely renders no chevron column
   * at all, for a leaf row that never needs the alignment (e.g. an entity
   * row already nested under its own group).
   */
  chevron?: 'expanded' | 'collapsed' | 'spacer';
  glyph: LucideIcon;
  primary: React.ReactNode;
  /** Trailing chip/badge inside the label row, e.g. a count, a plugin origin badge, or a "Global" tag. */
  badge?: React.ReactNode;
  /** Left-edge color spine marking this row's kind — the same signature used by WorkbenchCanvas's tab strip, so a session row here and a tab there read as one visual system. */
  accentColor?: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Trailing content after the label row, e.g. hover actions or a fixed-width create-action slot. */
  actions?: React.ReactNode;
  /** 'hover' (default) reveals `actions` on hover/focus-within, keyboard-reachable via :focus-within; 'always' renders them plainly, for actions that should never hide. */
  actionsVisibility?: 'hover' | 'always';
  muted?: boolean;
  disabled?: boolean;
  /** 'mono' for entity names (skills/agents); 'group' for a group-header row, in the same Kicker style as every other group header in the side panels. */
  labelVariant?: 'default' | 'mono' | 'group';
}

/** Kicker-style label for a tree group header (TreeGroup rows, the Sessões header) — one definition so every group header in the side panels reads the same. */
export const treeGroupLabelSx = {
  fontSize: '0.6rem',
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'text.secondary',
} as const;

function labelSx(variant: 'default' | 'mono' | 'group'): SxProps<Theme> {
  switch (variant) {
    case 'default':
      return { fontSize: '0.8rem' };
    case 'mono':
      return (theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.75rem' });
    case 'group':
      return treeGroupLabelSx;
  }
}

/**
 * The single row shape shared by every tree in the workspace side panels —
 * chevron + icon + truncated label + badge + accent spine + actions.
 * `FolderTree`'s file/folder rows and `TreeGroup`'s group-header/entity rows
 * both render through this instead of each solving the same layout on its
 * own.
 */
export function TreeRow({
  testId,
  pl,
  chevron,
  glyph,
  primary,
  badge,
  accentColor,
  onClick,
  onContextMenu,
  actions,
  actionsVisibility = 'hover',
  muted,
  disabled,
  labelVariant = 'default',
}: TreeRowProps): React.ReactElement {
  return (
    <ListItemButton
      dense
      disabled={disabled}
      {...(testId ? { 'data-testid': testId } : {})}
      onClick={onClick}
      onContextMenu={onContextMenu}
      sx={(theme) => ({
        pl,
        minHeight: 22,
        py: 0,
        mx: 0.75,
        borderRadius: `${theme.ogs.radius.xs}px`,
        opacity: muted ? 0.65 : 1,
        position: 'relative',
        '&:hover .tree-row-actions, &:focus-within .tree-row-actions, .tree-row-actions:has([aria-expanded="true"])': { opacity: 1 },
        // Hover actions take the origin text's place instead of squeezing the name.
        ...(actions && actionsVisibility === 'hover'
          ? { '&:hover .tree-row-origin, &:focus-within .tree-row-origin': { display: 'none' } }
          : {}),
        // `rail` is too close to `paper` in dark mode to read as a fill there.
        '&.Mui-selected, &.Mui-selected:hover': {
          bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.secondary.main, 0.16) : theme.ogs.surfaces.rail,
        },
      })}
    >
      {accentColor && (
        <Box
          sx={(theme) => ({
            // Inset so the spine sits inside the row's rounded pill.
            position: 'absolute', left: 2, top: 4, bottom: 4, width: 3,
            borderRadius: `${theme.ogs.radius.xs}px`, bgcolor: accentColor,
          })}
        />
      )}
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
        {chevron === 'spacer' ? (
          <Box sx={{ width: 14 }} />
        ) : chevron ? (
          <Icon glyph={chevron === 'expanded' ? ChevronDown : ChevronRight} size={14} />
        ) : null}
        <Icon glyph={glyph} size={14} />
        <ListItemText primary={primary} sx={{ my: 0 }} slotProps={{ primary: { noWrap: true, sx: labelSx(labelVariant) } }} />
        {badge}
      </Stack>
      {actions && (
        actionsVisibility === 'always' ? (
          actions
        ) : (
          <Box className="tree-row-actions" sx={{ display: 'flex', alignItems: 'center', opacity: 0, transition: 'opacity 120ms ease' }}>
            {actions}
          </Box>
        )
      )}
    </ListItemButton>
  );
}
