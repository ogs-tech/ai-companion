import { useState } from 'react';
import { Box, Button, Chip, Skeleton, Tooltip } from '@mui/material';
import { CircleAlert } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { GitBranchChip } from './git/GitBranchChip.js';
import { CommitPopover } from './git/CommitPopover.js';
import { GitSyncButton } from './git/GitSyncButton.js';
import { GitInitPopoverButton } from './git/GitInit.js';
import { groupChanges } from './git/git-decorations.js';
import type { GitActions } from './git/use-git-actions.js';
import type { GitStatus } from '../../../shared/git.js';

interface ExplorerToolbarProps {
  status: { isPending: boolean; error: Error | null; data: GitStatus | undefined };
  actions: Pick<
    GitActions,
    'busy' | 'syncing' | 'stage' | 'unstage' | 'commit' | 'init' | 'generateCommitMessage' | 'sync' | 'push' | 'pull' | 'fetch'
  >;
  /** Trailing actions, e.g. the "Reler do disco" refresh button. */
  trailing?: React.ReactNode;
}

export const GIT_NOT_FOUND_MESSAGE =
  'O git não foi encontrado no PATH. Instale o git (ex.: xcode-select --install ou Homebrew) e reabra o app.';

/** Branch chip + "Stage all" / "Commit…" over the file tree; degrades to a ⎇ init icon or an alert icon without a usable repo. */
export function ExplorerToolbar({ status, actions, trailing }: ExplorerToolbarProps): React.ReactElement {
  const [commitAnchor, setCommitAnchor] = useState<HTMLElement | null>(null);
  const data = status.data;

  const left = (() => {
    if (status.error) {
      const message = status.error.message === 'GitNotFound' ? GIT_NOT_FOUND_MESSAGE : `Não foi possível ler o status: ${status.error.message}`;
      return (
        <Tooltip title={message}>
          <Box
            component="span"
            role="img"
            aria-label={message}
            data-testid={status.error.message === 'GitNotFound' ? 'git-not-found' : 'git-status-error'}
            sx={{ display: 'inline-flex', color: 'warning.main', p: 0.5 }}
          >
            <Icon glyph={CircleAlert} size={14} />
          </Box>
        </Tooltip>
      );
    }
    if (status.isPending || !data) return <Skeleton variant="rounded" width={90} height={22} data-testid="git-loading" />;
    if (!data.isRepo) return <GitInitPopoverButton busy={actions.busy} onInit={actions.init} />;
    return <GitBranchChip head={data.head} />;
  })();

  const repo = data?.isRepo ? data : null;
  const { staged, changes } = repo ? groupChanges(repo.files) : { staged: [], changes: [] };

  return (
    <Box
      data-testid="explorer-toolbar"
      sx={{ flexShrink: 0, px: 1.25, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.5 }}
    >
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>{left}</Box>
      {repo && (
        <>
          <GitSyncButton status={repo} actions={actions} />
          {staged.length > 0 && (
            <Chip size="small" color="success" variant="outlined" label={`${staged.length} staged`} data-testid="git-chip-staged" />
          )}
          {changes.length > 0 && (
            <Chip size="small" color="warning" variant="outlined" label={`${changes.length} changes`} data-testid="git-chip-changes" />
          )}
          <Button
            size="small"
            disabled={actions.busy || changes.length === 0}
            data-testid="git-stage-all"
            onClick={() => actions.stage(changes.map((f) => f.path))}
            sx={{ textTransform: 'none', minWidth: 0, fontSize: '0.75rem' }}
          >
            Stage all
          </Button>
          <Button
            size="small"
            disabled={actions.busy || staged.length === 0}
            data-testid="git-unstage-all"
            onClick={() => actions.unstage(staged.map((f) => f.path))}
            sx={{ textTransform: 'none', minWidth: 0, fontSize: '0.75rem' }}
          >
            Unstage all
          </Button>
          <Button
            size="small"
            data-testid="git-commit-open"
            onClick={(e) => setCommitAnchor(e.currentTarget)}
            sx={{ textTransform: 'none', minWidth: 0, fontSize: '0.75rem' }}
          >
            Commit…
          </Button>
          <CommitPopover
            anchorEl={commitAnchor}
            stagedCount={staged.length}
            busy={actions.busy}
            onClose={() => setCommitAnchor(null)}
            onCommit={actions.commit}
            onGenerate={actions.generateCommitMessage}
          />
        </>
      )}
      {trailing}
    </Box>
  );
}
