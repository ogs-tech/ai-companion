import { useState } from 'react';
import { Box, Collapse, List, Stack, Tooltip, Typography } from '@mui/material';
import { Plus, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { TreeRow } from '../ds/TreeRow.js';
import { ProblemCount } from '../ds/ChannelWarning.js';
import { ChannelMarks } from '../ds/ChannelMarks.js';

interface TreeGroupProps {
  testId: string;
  glyph: LucideIcon;
  label: string;
  /** Omitted for a group whose "rows" are other `TreeGroup`s rather than counted items — e.g. "Integrações" wrapping Hooks/MCP/Plugins, each of which already carries its own count. */
  count?: number;
  /** Items inside with a problem in some channel — shown as `N ⚠` before the count, only when above zero. */
  problems?: number;
  onCreate?: () => void;
  createLabel?: string;
  /** Tree nesting level, matching FolderTree's `TreeNode` indent formula (`pl: 1.5 + depth * 2`) — for a group pinned inside a folder node rather than at the tree's own top level. Defaults to `0` (today's `pl: 1.5`). */
  depth?: number;
  /** Starts open — for a group that is the panel's primary content (e.g. Instruction). Defaults to collapsed. */
  defaultExpanded?: boolean;
  /** Renders only the rows — no header, no collapse — for a list whose heading lives elsewhere (the Control Panel's unified Customizations list). */
  flat?: boolean;
  children: React.ReactNode;
}

/**
 * A collapsible "folder" node for an entity kind (Skills/Agents/Hooks/MCP),
 * styled to match FolderTree's own folder rows so the tree reads as one
 * structure rather than a nav list bolted onto a file browser.
 */
export function TreeGroup({ testId, glyph, label, count, problems = 0, onCreate, createLabel, depth = 0, defaultExpanded = false, flat = false, children }: TreeGroupProps): React.ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pl = 1.5 + depth * 2;

  if (flat) return <List disablePadding>{children}</List>;

  return (
    <>
      <TreeRow
        testId={`tree-group-${testId}`}
        pl={pl}
        chevron={expanded ? 'expanded' : 'collapsed'}
        glyph={glyph}
        primary={label}
        labelVariant="group"
        onClick={() => setExpanded((v) => !v)}
        actionsVisibility="always"
        {...(count !== undefined ? { badge: <FolderCounts problems={problems} count={count} /> } : {})}
        actions={
          // Fixed-width whether or not this kind offers a create action, so every
          // group's count chip lands in the same column instead of drifting
          // right on the kinds (Hooks) with nothing trailing it.
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
        }
      />
      <Collapse in={expanded} unmountOnExit>
        {count === 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid={`tree-group-empty-${testId}`}
            sx={{ display: 'block', pl: pl + 14 / 8 + 2, py: 0.75 }}
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

/** `N ⚠` (only when N > 0) then the total, right-aligned on a folder row. */
function FolderCounts({ problems, count, channelKinds }: { problems: number; count: number; channelKinds?: readonly string[] | undefined }): React.ReactElement {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
      {channelKinds && count > 0 ? <ChannelMarks scope={{ kinds: channelKinds }} /> : <ProblemCount count={problems} />}
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
  /** Folder chevron — for a row that expands inline (a plugin). */
  chevron?: 'expanded' | 'collapsed';
  muted?: boolean;
  disabled?: boolean;
  /** See `TreeGroup`'s own `depth`. Defaults to `0`. */
  depth?: number;
  /** Render `primary` in the mono face — for entity names (skills/agents). */
  mono?: boolean;
}

/**
 * A dense entity row inside a `TreeGroup`, styled like a FolderTree file row: icon + name, and a
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

interface TreeSubGroupProps {
  testId: string;
  glyph: LucideIcon;
  label: string;
  count: number;
  /** Items inside with a problem — see `TreeGroup`'s `problems`. */
  problems?: number;
  /** Entity kinds whose channels the header speaks for: a mark per integrated channel replaces the bare `N ⚠`. */
  channelKinds?: readonly string[] | undefined;
  /** Indent level of the header row — see `TreeGroup`'s `depth`. */
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  /** Dims the header — a level with nothing in it. */
  muted?: boolean;
  children: React.ReactNode;
}

/**
 * A collapsible sub-heading inside a `TreeGroup` — e.g. one plugin's skills.
 * Controlled (`expanded`/`onToggle`) so the parent can persist the choice and
 * force it open while a search is active.
 */
export function TreeSubGroup({ testId, glyph, label, count, problems = 0, channelKinds, depth, expanded, onToggle, muted = false, children }: TreeSubGroupProps): React.ReactElement {
  return (
    <>
      <TreeRow
        testId={`tree-subgroup-${testId}`}
        pl={1.5 + depth * 2}
        chevron={expanded ? 'expanded' : 'collapsed'}
        glyph={glyph}
        primary={label}
        onClick={onToggle}
        muted={muted}
        badge={<FolderCounts problems={problems} count={count} channelKinds={channelKinds} />}
      />
      <Collapse in={expanded} unmountOnExit>
        <List disablePadding>{children}</List>
      </Collapse>
    </>
  );
}
