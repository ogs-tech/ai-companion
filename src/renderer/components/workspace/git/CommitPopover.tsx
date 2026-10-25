import { Popover } from '@mui/material';
import { CommitBox } from './CommitBox.js';

interface CommitPopoverProps {
  anchorEl: HTMLElement | null;
  stagedCount: number;
  busy: boolean;
  onClose: () => void;
  /** Resolves on success (the popover then closes), rejects on failure (it stays open with the message). */
  onCommit: (message: string, amend: boolean) => Promise<void>;
  onGenerate: () => Promise<string>;
}

export function CommitPopover({ anchorEl, stagedCount, busy, onClose, onCommit, onGenerate }: CommitPopoverProps): React.ReactElement {
  return (
    <Popover
      open={anchorEl !== null}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 340 } } }}
    >
      <CommitBox
        stagedCount={stagedCount}
        busy={busy}
        onGenerate={onGenerate}
        onCommit={(message, amend) =>
          onCommit(message, amend).then(() => {
            onClose();
          })
        }
      />
    </Popover>
  );
}
