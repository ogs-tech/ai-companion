import { useState } from 'react';
import { Box, Button, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import { GitBranch, X } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';

const DISMISS_KEY_PREFIX = 'ai-companion.git-init-card-dismissed.';

function readDismissed(workspaceId: string): boolean {
  try {
    return window.localStorage.getItem(`${DISMISS_KEY_PREFIX}${workspaceId}`) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(workspaceId: string): void {
  try {
    window.localStorage.setItem(`${DISMISS_KEY_PREFIX}${workspaceId}`, '1');
  } catch {
    // Storage unavailable: the dismissal lasts for this session only.
  }
}

interface GitInitProps {
  busy: boolean;
  onInit: () => void;
}

/** The toolbar's ⎇ icon when the folder is not a repo — always available, unlike the dismissible card. */
export function GitInitPopoverButton({ busy, onInit }: GitInitProps): React.ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title="Inicializar git">
        <IconButton size="small" aria-label="Inicializar git" data-testid="git-init-trigger" onClick={(e) => setAnchor(e.currentTarget)}>
          <Icon glyph={GitBranch} size={14} />
        </IconButton>
      </Tooltip>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 260, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' } } }}
      >
        <Typography variant="body2" color="text.secondary">
          Esta pasta não é um repositório git.
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          data-testid="git-init-btn"
          onClick={() => {
            setAnchor(null);
            onInit();
          }}
        >
          Inicializar
        </Button>
      </Popover>
    </>
  );
}

interface GitInitCardProps extends GitInitProps {
  workspaceId: string;
}

/** Footer card offering `git init`; dismissal is remembered per workspace in `localStorage`. */
export function GitInitCard({ workspaceId, busy, onInit }: GitInitCardProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(() => readDismissed(workspaceId));
  if (dismissed) return null;
  return (
    <Box
      data-testid="git-init-card"
      sx={{ m: 1, p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 1 }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
        Esta pasta não é um repositório git.
      </Typography>
      <Button size="small" variant="outlined" disabled={busy} data-testid="git-init-card-btn" onClick={onInit}>
        git init
      </Button>
      <Tooltip title="Dispensar">
        <IconButton
          size="small"
          aria-label="Dispensar"
          data-testid="git-init-card-dismiss"
          onClick={() => {
            writeDismissed(workspaceId);
            setDismissed(true);
          }}
        >
          <Icon glyph={X} size={13} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
