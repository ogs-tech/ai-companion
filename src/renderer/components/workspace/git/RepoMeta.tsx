import { Box, Typography } from '@mui/material';
import { GitBranch } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';
import type { GitStatus } from '../../../../shared/git.js';

/** The changes pill — the only coloured element of a folder row. */
export function ChangesPill({ count, testId }: { count: number; testId?: string }): React.ReactElement {
  return (
    <Box
      component="span"
      {...(testId ? { 'data-testid': testId } : {})}
      sx={(theme) => ({
        flexShrink: 0,
        px: 0.75,
        borderRadius: `${theme.ogs.radius.sm}px`,
        fontSize: '0.65rem',
        fontWeight: 600,
        lineHeight: '16px',
        fontFamily: theme.ogs.fonts.mono,
        color: 'warning.main',
        bgcolor: 'action.hover',
      })}
    >
      M {count}
    </Box>
  );
}

/** `⎇ branch` and, when dirty, the changes pill — a folder's git state on one row. Nothing outside a repository. */
export function RepoMeta({ status, testId }: { status: GitStatus | undefined; testId?: string }): React.ReactElement | null {
  if (!status?.isRepo) return null;
  const branch = status.head.name ?? 'HEAD';
  return (
    <Box component="span" {...(testId ? { 'data-testid': testId } : {})} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0, ml: 'auto' }}>
      <Typography component="span" noWrap sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, fontSize: '0.7rem', color: 'text.secondary', minWidth: 0 }}>
        <Icon glyph={GitBranch} size={11} />
        {branch}
      </Typography>
      {status.files.length > 0 && <ChangesPill count={status.files.length} />}
    </Box>
  );
}
