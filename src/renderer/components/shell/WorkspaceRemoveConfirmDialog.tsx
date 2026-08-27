import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

interface WorkspaceRemoveConfirmDialogProps {
  open: boolean;
  workspaceName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function WorkspaceRemoveConfirmDialog({
  open,
  workspaceName,
  onConfirm,
  onCancel,
}: WorkspaceRemoveConfirmDialogProps): React.ReactElement {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="workspace-remove-confirm-title"
      data-testid="workspace-remove-confirm-dialog"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="workspace-remove-confirm-title">Remover {workspaceName}?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Você voltará para o workspace Global e o workspace <strong>{workspaceName}</strong> deixará de
          aparecer na lista. A pasta do projeto e seus arquivos não são afetados.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button data-testid="workspace-remove-cancel-btn" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          data-testid="workspace-remove-confirm-btn"
          onClick={onConfirm}
          variant="contained"
          color="error"
        >
          Remover
        </Button>
      </DialogActions>
    </Dialog>
  );
}
