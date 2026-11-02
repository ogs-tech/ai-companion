import { Box, Collapse, List, Tooltip, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { TreeRow } from '../ds/TreeRow.js';
import { usePersistedFlag } from '../../lib/use-persisted-flag.js';

interface ScopeSectionProps {
  /** `local` = the open workspace's own items; `global` = Início's, inherited read-only. */
  section: 'local' | 'global';
  glyph: LucideIcon;
  label: string;
  count: number;
  /** Persistence key — one per workspace and section. */
  storageKey: string;
  /** Whether the section starts open when the user has not toggled it yet. */
  defaultOpen: boolean;
  /** Explains the section on hover, e.g. why it is read-only. */
  tooltip?: string;
  /** Opens the section (an active search). */
  forceOpen: boolean;
  /** Hides the header and rows without unmounting them. */
  hidden?: boolean;
  children: React.ReactNode;
}

/**
 * A top-level, collapsible header for one scope of the Control Panel list
 * inside a workspace. Children stay mounted while collapsed: they report the
 * row counts the header, the footer and the empty state depend on.
 */
export function ScopeSection({ section, glyph, label, count, storageKey, forceOpen, defaultOpen, tooltip, hidden = false, children }: ScopeSectionProps): React.ReactElement {
  const [stored, setStored] = usePersistedFlag(storageKey, defaultOpen);
  const expanded = forceOpen || stored;
  return (
    <Box sx={hidden ? { display: 'none' } : {}}>
      <TreeRow
        testId={`control-panel-section-${section}`}
        pl={1.5}
        chevron={expanded ? 'expanded' : 'collapsed'}
        glyph={glyph}
        primary={tooltip ? <Tooltip title={tooltip}><span>{label}</span></Tooltip> : label}
        onClick={() => setStored(!stored)}
        badge={<Typography component="span" sx={{ fontSize: '0.6875rem', color: 'text.disabled' }}>{count}</Typography>}
      />
      <Collapse in={expanded}>
        <List disablePadding>{children}</List>
      </Collapse>
    </Box>
  );
}
