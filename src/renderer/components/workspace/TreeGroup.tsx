import { Collapse, List, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { TreeRow } from '../ds/TreeRow.js';
import { ProblemCount } from '../ds/ChannelWarning.js';
import { usePersistedFlag } from '../../lib/use-persisted-flag.js';

/** `N ⚠` (only when N > 0) then the total, right-aligned on a folder row. */
function FolderCounts({ problems, count }: { problems: number; count: number }): React.ReactElement {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
      <ProblemCount count={problems} />
      <Typography component="span" sx={{ fontSize: '0.6875rem', color: 'text.disabled' }}>{count}</Typography>
    </Stack>
  );
}

interface TreeGroupRowProps {
  testId: string;
  glyph: LucideIcon;
  primary: React.ReactNode;
  /** Small trailing chip/badge, e.g. the `⚠ Cursor` channel warning. */
  badge?: React.ReactNode;
  onClick?: () => void;
  /** Right-click on the row — the home of edit/delete/etc.: a row reveals nothing on hover. */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Folder chevron — for a row that expands inline (a plugin); `spacer` keeps a sibling that can't expand aligned. */
  chevron?: 'expanded' | 'collapsed' | 'spacer';
  muted?: boolean;
  disabled?: boolean;
  /** Tree nesting level, matching FolderTree's indent formula. Defaults to `0`. */
  depth?: number;
  /** Render `primary` in the mono face — for entity names (skills/agents). */
  mono?: boolean;
}

/**
 * A dense entity row inside a group, styled like a FolderTree file row: icon + name, and a
 * badge only when there is something to say. Hover changes nothing — actions live in the context menu.
 */
export function TreeGroupRow({ testId, glyph, primary, badge, onClick, onContextMenu, chevron, muted, disabled, depth = 0, mono }: TreeGroupRowProps): React.ReactElement {
  return (
    <TreeRow
      testId={testId}
      pl={1.5 + 2.5 + depth * 2}
      glyph={glyph}
      primary={primary}
      badge={badge}
      {...(chevron ? { chevron } : {})}
      {...(onClick ? { onClick } : {})}
      {...(onContextMenu ? { onContextMenu } : {})}
      {...(muted !== undefined ? { muted } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(mono ? { labelVariant: 'mono' as const } : {})}
    />
  );
}

interface PersistedGroupProps {
  /** Group id: the header is `tree-group-<id>`, its empty state `tree-group-empty-<id>`. */
  id: string;
  glyph: LucideIcon;
  label: string;
  count: number;
  /** Items inside with a problem in some channel — `N ⚠` before the count. */
  problems?: number;
  /** Persistence key of the open state. */
  storageKey: string;
  /** Opens the group regardless of the stored choice (an active search or chip). */
  forceOpen: boolean;
  depth: number;
  /** Whether the group starts open when the user has not toggled it yet. */
  defaultOpen: boolean;
  /** True when the group has no rows to list: it shows "Nada aqui ainda" instead. */
  empty?: boolean;
  children: React.ReactNode;
}

/** A collapsible type group of the Customizações tree ("Skills", "MCP") whose open state is remembered. */
export function PersistedGroup({ id, glyph, label, count, problems = 0, storageKey, forceOpen, depth, defaultOpen, empty = false, children }: PersistedGroupProps): React.ReactElement {
  const [stored, setStored] = usePersistedFlag(storageKey, defaultOpen);
  const expanded = forceOpen || stored;
  const pl = 1.5 + depth * 2;
  return (
    <>
      <TreeRow
        testId={`tree-group-${id}`}
        pl={pl}
        chevron={expanded ? 'expanded' : 'collapsed'}
        glyph={glyph}
        primary={label}
        onClick={() => setStored(!stored)}
        badge={<FolderCounts problems={problems} count={count} />}
        rowProps={{ 'aria-expanded': expanded }}
      />
      <Collapse in={expanded} unmountOnExit>
        {empty ? (
          <Typography variant="caption" color="text.secondary" data-testid={`tree-group-empty-${id}`} sx={{ display: 'block', pl: pl + 4.5, py: 0.5 }}>
            Nada aqui ainda
          </Typography>
        ) : (
          <List disablePadding>{children}</List>
        )}
      </Collapse>
    </>
  );
}
