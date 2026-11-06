import { Alert, Button } from '@mui/material';
import { useFileMarks } from '../../hooks/use-sessions.js';

interface SessionFileBannerProps {
  relPath: string;
  /** The user has unsaved changes in this file's tab. */
  dirty: boolean;
  /** Opens the file's working-tree diff. */
  onViewDiff: () => void;
}

/** Above a file's editor: a session is editing it (conflict when the user has unsaved edits) or changed it this turn. Never locks anything. */
export function SessionFileBanner({ relPath, dirty, onViewDiff }: SessionFileBannerProps): React.ReactElement | null {
  const mark = useFileMarks().get(relPath);
  if (!mark) return null;
  const editing = mark.editing.length > 0;
  if (!editing && mark.changed.length === 0) return null;
  const conflict = editing && dirty;
  const names = (editing ? mark.editing : mark.changed).join(', ');
  return (
    <Alert
      severity={conflict ? 'warning' : 'info'}
      data-testid={conflict ? 'session-file-conflict' : 'session-file-changed'}
      sx={{ borderRadius: 0 }}
      action={
        <Button color="inherit" size="small" onClick={onViewDiff}>
          {conflict ? 'Ver o que mudou' : 'Ver diff'}
        </Button>
      }
    >
      {conflict
        ? `${names} está editando este arquivo e você tem alterações não salvas. Salvar sobrescreve o que a sessão escreveu.`
        : editing
          ? `${names} está editando este arquivo agora.`
          : `${names} alterou este arquivo neste turno.`}
    </Alert>
  );
}
