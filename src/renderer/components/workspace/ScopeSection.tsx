import { Box, Collapse, List, Tooltip, Typography } from '@mui/material';
import { TreeRow } from '../ds/TreeRow.js';
import { treeIndent } from './TreeGroup.js';
import { usePersistedFlag } from '../../lib/use-persisted-flag.js';

interface ScopeSectionProps {
  /** `global` = Início's items, editable from here too. */
  section: 'global';
  label: string;
  /** Says what the section is, after the label — e.g. that a change applies to every workspace. */
  caption?: string;
  count: number;
  /** Persistence key — one per workspace and section. */
  storageKey: string;
  /** Whether the section starts open when the user has not toggled it yet. */
  defaultOpen: boolean;
  /** The longer explanation on hover. */
  tooltip?: string;
  /** Opens the section (an active search). */
  forceOpen: boolean;
  children: React.ReactNode;
}

/**
 * The collapsible header of a scope other than the open workspace's own inside the Customizações tree — today,
 * Global's items below the workspace's.
 */
export function ScopeSection({ section, label, caption, count, storageKey, forceOpen, defaultOpen, tooltip, children }: ScopeSectionProps): React.ReactElement {
  const [stored, setStored] = usePersistedFlag(storageKey, defaultOpen);
  const expanded = forceOpen || stored;
  const title = (
    <span>
      <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
        {label}
      </Box>
      {caption && (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {' — '}
          {caption}
        </Box>
      )}
    </span>
  );
  return (
    <Box>
      <TreeRow
        testId={`control-panel-section-${section}`}
        pl={treeIndent(0)}
        chevron={expanded ? 'expanded' : 'collapsed'}
        primary={tooltip ? <Tooltip title={tooltip}>{title}</Tooltip> : title}
        labelVariant="heading"
        density="comfortable"
        onClick={() => setStored(!stored)}
        badge={
          <Typography component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {count}
          </Typography>
        }
        rowProps={{ 'aria-expanded': expanded }}
      />
      <Collapse in={expanded}>
        <List disablePadding>{children}</List>
      </Collapse>
    </Box>
  );
}
