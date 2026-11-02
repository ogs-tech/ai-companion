import { useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Typography } from '@mui/material';
import { folderColor } from '../../lib/folder-identity.js';

interface NewSessionDialogProps {
  open: boolean;
  /** Absolute folders of the workspace, in order. */
  folders: readonly string[];
  aliases: Record<string, string>;
  /** Ticked when the dialog opens — the folder of the item the user is looking at. */
  defaultFolder?: string;
  onStart: (folders: string[]) => void;
  onCancel: () => void;
}

/**
 * Which of the workspace's folders a new session sees. Folders left unticked
 * are completely outside the session. One folder runs in it; two or more run
 * from a helper directory linking to exactly the ticked ones (no main folder).
 */
export function NewSessionDialog(props: NewSessionDialogProps): React.ReactElement {
  // Mounted only while open, so every opening starts from the default tick.
  return props.open ? <NewSessionForm {...props} /> : <></>;
}

function NewSessionForm({ folders, aliases, defaultFolder, onStart, onCancel }: NewSessionDialogProps): React.ReactElement {
  const [ticked, setTicked] = useState<string[]>(() => [defaultFolder ?? (folders[0] as string)]);

  const all = ticked.length === folders.length;
  const toggle = (folder: string): void =>
    setTicked((prev) => (prev.includes(folder) ? prev.filter((f) => f !== folder) : folders.filter((f) => prev.includes(f) || f === folder)));

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth data-testid="new-session-dialog">
      <DialogTitle>Nova sessão</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          Escolha as pastas que a sessão enxerga. As que ficarem de fora ficam fora de verdade — nem como diretório extra.
        </DialogContentText>
        <FormControlLabel
          label="Todas as pastas"
          control={
            <Checkbox
              size="small"
              checked={all}
              indeterminate={!all && ticked.length > 0}
              onChange={() => setTicked(all ? [] : [...folders])}
              slotProps={{ input: { 'data-testid': 'new-session-all' } as React.InputHTMLAttributes<HTMLInputElement> }}
            />
          }
        />
        {folders.map((folder) => (
          <Box key={folder} sx={{ display: 'block', pl: 2 }}>
            <FormControlLabel
              label={
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: folderColor(folders, folder) }} />
                  <Typography component="span" variant="body2">{aliases[folder]}</Typography>
                </Box>
              }
              control={
                <Checkbox
                  size="small"
                  checked={ticked.includes(folder)}
                  onChange={() => toggle(folder)}
                  slotProps={{ input: { 'data-testid': `new-session-folder-${aliases[folder]}` } as React.InputHTMLAttributes<HTMLInputElement> }}
                />
              }
            />
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button data-testid="new-session-cancel" onClick={onCancel}>Cancelar</Button>
        <Button data-testid="new-session-start" variant="contained" disabled={ticked.length === 0} onClick={() => onStart(ticked)}>
          Iniciar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
