import { Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { SessionPanel } from '../SessionPanel.js';
import type { SessionAnchor } from '../../../shared/session.js';

interface SessionDialogProps {
  open: boolean;
  anchor: SessionAnchor | null;
  title: string;
  onClose: () => void;
}

export function SessionDialog({ open, anchor, title, onClose }: SessionDialogProps): React.ReactElement {
  return (
    <Dialog open={open && anchor !== null} onClose={onClose} maxWidth="md" fullWidth data-testid="session-dialog">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {title}
        <IconButton onClick={onClose} size="small" aria-label="Fechar">
          <Icon glyph={X} size={16} />
        </IconButton>
      </DialogTitle>
      <DialogContent>{anchor && <SessionPanel anchor={anchor} />}</DialogContent>
    </Dialog>
  );
}
