import { Box, Skeleton, Tooltip, Typography } from '@mui/material';
import { CircleAlert } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { GitBranchChip } from './git/GitBranchChip.js';
import { GitSyncButton } from './git/GitSyncButton.js';
import type { GitActions } from './git/use-git-actions.js';
import type { GitStatus } from '../../../shared/git.js';

interface ExplorerToolbarProps {
  status: { isPending: boolean; error: Error | null; data: GitStatus | undefined };
  actions: Pick<GitActions, 'busy' | 'syncing' | 'sync' | 'push' | 'pull' | 'fetch'>;
}

export const GIT_NOT_FOUND_MESSAGE =
  'O git não foi encontrado no PATH. Instale o git (ex.: xcode-select --install ou Homebrew) e reabra o app.';

/** The Git view's header: the branch on the left, sync (⟳ and its ⋯ menu) on the right. Staging and committing live in the sections below. */
export function ExplorerToolbar({ status, actions }: ExplorerToolbarProps): React.ReactElement {
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
    if (!data.isRepo) {
      return (
        <Typography component="span" variant="caption" color="text.secondary">
          Sem repositório git
        </Typography>
      );
    }
    return <GitBranchChip head={data.head} />;
  })();

  return (
    <Box
      data-testid="explorer-toolbar"
      sx={{ flexShrink: 0, px: 1.25, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.5 }}
    >
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>{left}</Box>
      {data?.isRepo && <GitSyncButton status={data} actions={actions} />}
    </Box>
  );
}
