import { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';

interface RenameWorkspaceDialogProps {
  open: boolean;
  /** Pre-filled with the current name. */
  currentName: string;
  /** Shown above the field — why the app is asking (e.g. a second folder was just added). */
  reason?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function RenameWorkspaceDialog(props: RenameWorkspaceDialogProps): React.ReactElement {
  // Mounted only while open, so every opening starts from the current name.
  return props.open ? <RenameForm {...props} /> : <></>;
}

function RenameForm({ currentName, reason, onSubmit, onCancel }: RenameWorkspaceDialogProps): React.ReactElement {
  const [name, setName] = useState(currentName);

  const trimmed = name.trim();
  const submit = (): void => {
    if (trimmed !== '') onSubmit(trimmed);
  };

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth data-testid="rename-workspace-dialog">
      <DialogTitle>Renomear workspace</DialogTitle>
      <DialogContent>
        {reason && <DialogContentText sx={{ mb: 2 }}>{reason}</DialogContentText>}
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Nome do workspace"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          slotProps={{ htmlInput: { 'data-testid': 'rename-workspace-input' } }}
        />
      </DialogContent>
      <DialogActions>
        <Button data-testid="rename-workspace-cancel" onClick={onCancel}>
          Manter nome
        </Button>
        <Button data-testid="rename-workspace-submit" variant="contained" disabled={trimmed === ''} onClick={submit}>
          Renomear
        </Button>
      </DialogActions>
    </Dialog>
  );
}
