import { useState } from 'react';
import { Box, Chip, Collapse, List, ListItemButton, ListItemText, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronRight, ChevronDown, Plus, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';

interface TreeGroupProps {
  testId: string;
  glyph: LucideIcon;
  label: string;
  count: number;
  onCreate?: () => void;
  createLabel?: string;
  children: React.ReactNode;
}

/**
 * A collapsible "folder" node for an entity kind (Skills/Agents/Hooks/MCP),
 * styled to match FolderTree's own folder rows so the tree reads as one
 * structure rather than a nav list bolted onto a file browser.
 */
export function TreeGroup({ testId, glyph, label, count, onCreate, createLabel, children }: TreeGroupProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <ListItemButton
        dense
        data-testid={`tree-group-${testId}`}
        onClick={() => setExpanded((v) => !v)}
        sx={{ pl: 1.5 }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
          <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />
          <Icon glyph={glyph} size={14} />
          <ListItemText primary={label} slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }} />
          <Chip size="small" label={count} sx={{ height: 18, fontSize: '0.6875rem', '& .MuiChip-label': { px: 0.75 } }} />
        </Stack>
        {/* Fixed-width whether or not this kind offers a create action, so every
            group's count chip lands in the same column instead of drifting
            right on the kinds (Hooks) with nothing trailing it. */}
        <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          {onCreate && (
            <Tooltip title={createLabel ?? 'Novo'}>
              <Box
                component="span"
                role="button"
                tabIndex={0}
                aria-label={createLabel ?? 'Novo'}
                data-testid={`tree-group-new-${testId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCreate();
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  if (e.key === ' ') e.preventDefault();
                  e.stopPropagation();
                  onCreate();
                }}
                sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
              >
                <Icon glyph={Plus} size={14} />
              </Box>
            </Tooltip>
          )}
        </Box>
      </ListItemButton>
      <Collapse in={expanded} unmountOnExit>
        {count === 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid={`tree-group-empty-${testId}`}
            sx={{ display: 'block', pl: 1.5 + 14 / 8 + 2, py: 0.75 }}
          >
            Nada aqui ainda
          </Typography>
        ) : (
          <List disablePadding>{children}</List>
        )}
      </Collapse>
    </>
  );
}

interface TreeGroupRowProps {
  testId: string;
  glyph: LucideIcon;
  primary: React.ReactNode;
  /** Small trailing chip/badge, e.g. a plugin origin badge or a "Global" tag. */
  badge?: React.ReactNode;
  onClick?: () => void;
  /** Trailing hover actions (edit/delete/etc.), stopPropagation'd from onClick. */
  actions?: React.ReactNode;
  muted?: boolean;
  /** Left-edge color spine marking this row's kind — the same signature used by WorkbenchCanvas's tab strip, so a session row here and a tab there read as one visual system. */
  accentColor?: string;
}

/** A dense entity row inside a `TreeGroup`, styled like a FolderTree file row. */
export function TreeGroupRow({ testId, glyph, primary, badge, onClick, actions, muted, accentColor }: TreeGroupRowProps): React.ReactElement {
  return (
    <ListItemButton
      dense
      data-testid={testId}
      onClick={onClick}
      sx={{ pl: 1.5 + 2.5, opacity: muted ? 0.65 : 1, position: 'relative' }}
    >
      {accentColor && (
        <Box
          sx={(theme) => ({
            position: 'absolute', left: 0, top: 4, bottom: 4, width: 3,
            borderRadius: `${theme.ogs.radius.xs}px`, bgcolor: accentColor,
          })}
        />
      )}
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
        <Icon glyph={glyph} size={14} />
        <ListItemText primary={primary} slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }} />
        {badge}
      </Stack>
      {actions}
    </ListItemButton>
  );
}
