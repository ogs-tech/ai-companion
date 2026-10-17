import { Chip } from '@mui/material';
import { GitBranch } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';
import type { GitBranchHead } from '../../../../shared/git.js';

/** Branch name (or detached HEAD), "sem commits" on an unborn branch, and ↑ahead ↓behind. */
export function GitBranchChip({ head }: { head: GitBranchHead }): React.ReactElement {
  const name = head.name ?? (head.oid ? `HEAD destacado (${head.oid.slice(0, 7)})` : 'HEAD destacado');
  const parts = [name];
  if (head.oid === null) parts.push('sem commits');
  if (head.ahead > 0 || head.behind > 0) parts.push(`↑${head.ahead} ↓${head.behind}`);
  return (
    <Chip
      size="small"
      variant="outlined"
      data-testid="git-head"
      icon={<Icon glyph={GitBranch} size={12} />}
      label={parts.join(' · ')}
      sx={{ maxWidth: '100%', height: 22, fontSize: '0.7rem', '& .MuiChip-label': { px: 0.75 } }}
    />
  );
}
