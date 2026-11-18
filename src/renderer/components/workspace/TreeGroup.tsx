import { Collapse, List, Stack, Typography } from '@mui/material';
import { TreeRow } from '../ds/TreeRow.js';
import { ProblemCount } from '../ds/ChannelWarning.js';
import { RowMenuButton } from './RowMenuButton.js';
import { usePersistedFlag } from '../../lib/use-persisted-flag.js';

/**
 * Left padding (theme units) of a Customizações row at `depth`. One level is the chevron's width, so a child's label
 * starts where its parent's label does.
 */
export function treeIndent(depth: number): number {
  return 0.75 + depth * 2.5;
}

const COUNT_SX = { fontSize: '0.75rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' } as const;

/** `● N` (only when N > 0) then the total, right-aligned on a group row. */
function GroupCounts({ problems, count }: { problems: number; count: number }): React.ReactElement {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
      <ProblemCount count={problems} />
      <Typography component="span" sx={COUNT_SX}>
        {count}
      </Typography>
    </Stack>
  );
}

interface TreeGroupRowProps {
  testId: string;
  primary: React.ReactNode;
  /** Small trailing tag, e.g. the `Erro no Cursor` channel warning. */
  badge?: React.ReactNode;
  onClick?: () => void;
  /** The row's menu: opened by right-click and by the `⋯` the row reveals on hover or focus. */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Folder chevron — for a row that expands inline (a plugin); `spacer` keeps a sibling that can't expand aligned. */
  chevron?: 'expanded' | 'collapsed' | 'spacer';
  /** Disabled or detected: quieter than an active row, still readable. */
  muted?: boolean;
  /** How `muted` reads: `quiet` (secondary text, disabled) or `recede` (lower opacity, detected). Defaults to `quiet`. */
  mutedStyle?: 'quiet' | 'recede';
  disabled?: boolean;
  /** Tree nesting level (see `treeIndent`). Defaults to `0`. */
  depth?: number;
  /** Renders `primary` as a group heading (a plugin's per-kind rows). */
  heading?: boolean;
}

/**
 * One item of the Customizações tree: its name, and a tag only when there is something to say. The group above
 * already names the type, so the row carries no icon.
 */
export function TreeGroupRow({ testId, primary, badge, onClick, onContextMenu, chevron, muted, mutedStyle = 'quiet', disabled, depth = 0, heading = false }: TreeGroupRowProps): React.ReactElement {
  return (
    <TreeRow
      testId={testId}
      pl={treeIndent(depth)}
      primary={primary}
      badge={badge}
      density="comfortable"
      labelVariant={heading ? 'heading' : 'item'}
      mutedStyle={mutedStyle}
      {...(chevron ? { chevron } : {})}
      {...(onClick ? { onClick } : {})}
      {...(onContextMenu
        ? {
            onContextMenu,
            actions: <RowMenuButton testId={`row-actions-${testId}-btn`} label="Ações" onOpen={onContextMenu} />,
          }
        : {})}
      {...(muted !== undefined ? { muted } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    />
  );
}

interface PersistedGroupProps {
  /** Group id: the header is `tree-group-<id>`. */
  id: string;
  label: string;
  count: number;
  /** Items inside with a problem in some channel — `● N` before the count. */
  problems?: number;
  /** Persistence key of the open state. */
  storageKey: string;
  /** Opens the group regardless of the stored choice (an active search or chip). */
  forceOpen: boolean;
  depth: number;
  /** Whether the group starts open when the user has not toggled it yet. */
  defaultOpen: boolean;
  children: React.ReactNode;
}

/** A collapsible type group of the Customizações tree ("Skills", "MCP") whose open state is remembered. */
export function PersistedGroup({ id, label, count, problems = 0, storageKey, forceOpen, depth, defaultOpen, children }: PersistedGroupProps): React.ReactElement {
  const [stored, setStored] = usePersistedFlag(storageKey, defaultOpen);
  const expanded = forceOpen || stored;
  return (
    <>
      <TreeRow
        testId={`tree-group-${id}`}
        pl={treeIndent(depth)}
        chevron={expanded ? 'expanded' : 'collapsed'}
        primary={label}
        labelVariant="heading"
        density="comfortable"
        onClick={() => setStored(!stored)}
        badge={<GroupCounts problems={problems} count={count} />}
        rowProps={{ 'aria-expanded': expanded }}
      />
      <Collapse in={expanded} unmountOnExit>
        <List disablePadding>{children}</List>
      </Collapse>
    </>
  );
}
