import { Box, Tooltip } from '@mui/material';
import type { FileMark } from '../../lib/session-usage.js';

/** A dot beside a file in the explorer: green = a session is editing it now, grey = changed this turn, amber = a session edits a file the user has unsaved changes in. */
export function SessionFileBadge({ mark, conflict, testId }: { mark: FileMark; conflict: boolean; testId: string }): React.ReactElement | null {
  const editing = mark.editing.length > 0;
  if (!editing && mark.changed.length === 0) return null;
  const color = conflict ? 'warning.main' : editing ? 'success.main' : 'text.disabled';
  const names = (editing ? mark.editing : mark.changed).join(', ');
  const title = conflict
    ? `${names} edita este arquivo e você tem alterações não salvas`
    : editing
      ? `Sendo editado agora por ${names}`
      : `Alterado neste turno por ${names}`;
  return (
    <Tooltip title={title}>
      <Box
        component="span"
        role="img"
        aria-label={title}
        data-testid={testId}
        data-mark={conflict ? 'conflict' : editing ? 'editing' : 'changed'}
        sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0, ml: 0.5 }}
      />
    </Tooltip>
  );
}
