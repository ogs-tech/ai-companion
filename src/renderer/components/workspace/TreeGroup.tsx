import { useState } from 'react';
import { Box, Chip, Collapse, List, Tooltip, Typography } from '@mui/material';
import { Plus, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { TreeRow } from '../ds/TreeRow.js';

interface TreeGroupProps {
  testId: string;
  glyph: LucideIcon;
  label: string;
  /** Omitted for a group whose "rows" are other `TreeGroup`s rather than counted items — e.g. "Integrações" wrapping Hooks/MCP/Plugins, each of which already carries its own count. */
  count?: number;
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
      <TreeRow
        testId={`tree-group-${testId}`}
        pl={1.5}
        chevron={expanded ? 'expanded' : 'collapsed'}
        glyph={glyph}
        primary={label}
        onClick={() => setExpanded((v) => !v)}
        actionsVisibility="always"
        {...(count !== undefined
          ? { badge: <Chip size="small" label={count} sx={{ height: 18, fontSize: '0.6875rem', '& .MuiChip-label': { px: 0.75 } }} /> }
          : {})}
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
  /** Right-click on the row — e.g. to open a "Preview" context menu. */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Trailing hover actions (edit/delete/etc.), stopPropagation'd from onClick. */
  actions?: React.ReactNode;
  muted?: boolean;
  /** Left-edge color spine marking this row's kind — the same signature used by WorkbenchCanvas's tab strip, so a session row here and a tab there read as one visual system. */
  accentColor?: string;
}

/**
 * A dense entity row inside a `TreeGroup`, styled like a FolderTree file row.
 * `actions` (delete/etc.) stay invisible until the row is hovered or focused
 * — kept reachable by keyboard via `:focus-within`, not just mouse hover —
 * so a row reads as calm as a plain file/agent name until the user actually
 * means to act on it.
 */
export function TreeGroupRow({ testId, glyph, primary, badge, onClick, onContextMenu, actions, muted, accentColor }: TreeGroupRowProps): React.ReactElement {
  return (
    <TreeRow
      testId={testId}
      pl={1.5 + 2.5}
      glyph={glyph}
      primary={primary}
      badge={badge}
      actions={actions}
      {...(accentColor !== undefined ? { accentColor } : {})}
      {...(onClick ? { onClick } : {})}
      {...(onContextMenu ? { onContextMenu } : {})}
      {...(muted !== undefined ? { muted } : {})}
    />
  );
}
