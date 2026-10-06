import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import type { GitFileChange } from '../../../../shared/git.js';

interface DiscardConfirmDialogProps {
  /** The files about to be discarded; `null` closes the dialog. */
  files: GitFileChange[] | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Names exactly what a discard loses: edits to tracked files, and untracked files outright. */
export function DiscardConfirmDialog({
  files,
  onConfirm,
  onCancel,
}: DiscardConfirmDialogProps): React.ReactElement {
  const list = files ?? [];
  const untracked = list.filter((f) => f.worktree === 'untracked');
  const tracked = list.filter((f) => f.worktree !== 'untracked');
  const title =
    list.length === 1
      ? `Descartar alterações em ${list[0]?.path}?`
      : `Descartar alterações em ${list.length} arquivos?`;

  return (
    <Dialog
      open={files !== null}
      onClose={onCancel}
      aria-labelledby="git-discard-confirm-title"
      data-testid="git-discard-confirm-dialog"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="git-discard-confirm-title" sx={{ wordBreak: 'break-all' }}>
        {title}
      </DialogTitle>
      <DialogContent>
        {tracked.length > 0 && (
          <DialogContentText>
            As alterações não staged destes arquivos serão perdidas (o que já está em stage é
            mantido):
          </DialogContentText>
        )}
        <FileList files={tracked} />
        {untracked.length > 0 && (
          <DialogContentText sx={{ mt: tracked.length > 0 ? 1.5 : 0 }}>
            Estes arquivos não rastreados serão <strong>apagados do disco</strong>:
          </DialogContentText>
        )}
        <FileList files={untracked} />
        <DialogContentText sx={{ mt: 1.5 }}>Esta ação não pode ser desfeita.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button data-testid="git-discard-cancel-btn" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          data-testid="git-discard-confirm-btn"
          onClick={onConfirm}
          variant="contained"
          color="error"
        >
          Descartar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FileList({ files }: { files: GitFileChange[] }): React.ReactElement | null {
  if (files.length === 0) return null;
  return (
    <Box
      component="ul"
      sx={(theme) => ({
        m: 0,
        mt: 0.5,
        pl: 2.5,
        maxHeight: 160,
        overflowY: 'auto',
        fontFamily: theme.ogs.fonts.mono,
        fontSize: '0.75rem',
        wordBreak: 'break-all',
      })}
    >
      {files.map((f) => (
        <li key={f.path}>{f.path}</li>
      ))}
    </Box>
  );
}
