import { useState } from 'react';
import { Box, Button } from '@mui/material';
import { CommitPopover } from './CommitPopover.js';
import type { GitActions } from './use-git-actions.js';

interface CommitBarProps {
  stagedCount: number;
  actions: Pick<GitActions, 'busy' | 'commit' | 'generateCommitMessage'>;
  /**
   * `primary` is the single-repository view's pinned button; `link` is the
   * quiet per-folder action of the multi-folder Repositórios list.
   */
  variant: 'primary' | 'link';
  /** Link variant only: the folder the commit goes to, shown in the label. */
  folderLabel?: string;
}

/** Opens the existing commit popover; disabled until something is staged. */
export function CommitBar({ stagedCount, actions, variant, folderLabel }: CommitBarProps): React.ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const disabled = actions.busy || stagedCount === 0;
  const popover = (
    <CommitPopover
      anchorEl={anchor}
      placement={variant === 'primary' ? 'above' : 'below'}
      stagedCount={stagedCount}
      busy={actions.busy}
      onClose={() => setAnchor(null)}
      onCommit={actions.commit}
      onGenerate={actions.generateCommitMessage}
    />
  );

  if (variant === 'link') {
    return (
      <Box sx={{ pl: 4.5, py: 0.25 }}>
        <Button
          size="small"
          disabled={disabled}
          data-testid="git-commit-open"
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ textTransform: 'none', minWidth: 0, p: 0, fontSize: '0.75rem', textDecoration: 'underline', textUnderlineOffset: '3px' }}
        >
          {`Commit (${folderLabel ?? ''})…`}
        </Button>
        {popover}
      </Box>
    );
  }
  return (
    <Box sx={{ flexShrink: 0, p: 1, borderTop: 1, borderColor: 'divider' }}>
      <Button fullWidth variant="contained" size="small" disabled={disabled} data-testid="git-commit-open" onClick={(e) => setAnchor(e.currentTarget)} sx={{ textTransform: 'none' }}>
        {`Commit (${stagedCount})`}
      </Button>
      {popover}
    </Box>
  );
}
