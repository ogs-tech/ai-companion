import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { workspacePathHint } from '../../../shared/brand.js';

interface RestoreConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestoreConfirmDialog({
  open,
  onConfirm,
  onCancel,
}: RestoreConfirmDialogProps): React.ReactElement {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="restore-confirm-title"
      data-testid="restore-confirm-dialog"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="restore-confirm-title">Restaurar para estado inicial?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Esta ação irá <strong>restaurar o app ao estado inicial</strong>: remove o diretório{' '}
          <code>{workspacePathHint()}</code> e os symlinks que o app criou em <code>~/.claude</code>, e
          fecha o aplicativo. O restante da sua configuração do Claude não é afetado. Isso não pode
          ser desfeito.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button data-testid="restore-cancel-btn" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          data-testid="restore-confirm-btn"
          onClick={onConfirm}
          variant="contained"
          color="error"
        >
          Restaurar e fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
