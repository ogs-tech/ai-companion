import { useState } from 'react';
import { Box, Button, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import { ArrowDown, ArrowUp, CloudUpload, EllipsisVertical, RefreshCw, type LucideIcon } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';
import { syncActionFor, type GitBranchHead, type GitStatus, type GitSyncAction } from '../../../../shared/git.js';
import type { GitActions } from './use-git-actions.js';

type RepoStatus = Extract<GitStatus, { isRepo: true }>;

const GLYPHS: Record<Exclude<GitSyncAction, 'none'>, LucideIcon> = {
  publish: CloudUpload,
  push: ArrowUp,
  pull: ArrowDown,
  sync: RefreshCw,
  fetch: RefreshCw,
};

const RUNNING_LABEL: Record<Exclude<GitSyncAction, 'none'>, string> = {
  publish: 'Enviando…',
  push: 'Enviando…',
  pull: 'Baixando…',
  sync: 'Sincronizando…',
  fetch: 'Baixando…',
};

function labelFor(action: Exclude<GitSyncAction, 'none'>, head: GitBranchHead): string {
  switch (action) {
    case 'publish':
      return 'Publicar branch';
    case 'push':
      return `Push ${head.ahead}`;
    case 'pull':
      return `Pull ${head.behind}`;
    case 'sync':
      return `Sincronizar ↑${head.ahead} ↓${head.behind}`;
    case 'fetch':
      return 'Fetch';
  }
}

interface GitSyncButtonProps {
  status: RepoStatus;
  actions: Pick<GitActions, 'busy' | 'syncing' | 'sync' | 'push' | 'pull' | 'fetch'>;
}

/** Smart push / pull / fetch / publish button (the action follows the repo state) plus a ⋯ menu for each op alone. */
export function GitSyncButton({ status, actions }: GitSyncButtonProps): React.ReactElement | null {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { head } = status;
  if (head.name === null || head.oid === null) return null; // detached or unborn: nothing to sync

  const inProgress = status.state !== 'clean';
  const action = syncActionFor(status);
  const running = actions.syncing;
  const disabled = actions.busy || inProgress;
  const hasUpstream = head.upstream !== undefined;
  const closeAnd = (run: () => void) => () => {
    setMenuAnchor(null);
    run();
  };

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }} data-testid="git-sync">
      <Tooltip title={inProgress ? `Operação em andamento (${status.state}) — resolva antes de sincronizar.` : ''}>
        <span>
          {action !== 'none' && (
            <Button
              size="small"
              disabled={disabled}
              data-testid="git-sync-button"
              startIcon={<Icon glyph={GLYPHS[running ?? action]} size={13} />}
              onClick={actions.sync}
              sx={{ textTransform: 'none', minWidth: 0, fontSize: '0.75rem' }}
            >
              {running ? RUNNING_LABEL[running] : labelFor(action, head)}
            </Button>
          )}
        </span>
      </Tooltip>
      <IconButton
        size="small"
        aria-label="Mais ações de sincronização"
        data-testid="git-sync-menu"
        disabled={disabled}
        onClick={(e) => setMenuAnchor(e.currentTarget)}
      >
        <Icon glyph={EllipsisVertical} size={14} />
      </IconButton>
      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
        <MenuItem data-testid="git-sync-fetch" onClick={closeAnd(actions.fetch)}>
          Fetch
        </MenuItem>
        <MenuItem data-testid="git-sync-pull" disabled={!hasUpstream} onClick={closeAnd(actions.pull)}>
          Pull
        </MenuItem>
        <MenuItem
          data-testid="git-sync-push"
          disabled={hasUpstream && head.ahead === 0}
          onClick={closeAnd(actions.push)}
        >
          {hasUpstream ? 'Push' : 'Publicar branch'}
        </MenuItem>
      </Menu>
    </Box>
  );
}
