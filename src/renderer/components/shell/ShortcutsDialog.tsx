import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { SHORTCUTS, type MenuCommand } from '../../../shared/desktop.js';
import { SHORTCUT_LABELS, shortcutFor } from '../../lib/shortcut-labels.js';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Ajuda › Atalhos de teclado: read straight from the table the native menu registers, so it can't drift. */
export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps): React.ReactElement {
  const commands = (Object.keys(SHORTCUTS) as MenuCommand[]).filter((c) => SHORTCUT_LABELS[c] !== undefined);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="shortcuts-title" data-testid="shortcuts-dialog">
      <DialogTitle id="shortcuts-title">Atalhos de teclado</DialogTitle>
      <DialogContent>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 1, columnGap: 3 }}>
          {commands.map((command) => (
            <Box key={command} sx={{ display: 'contents' }}>
              <Box component="dt">{SHORTCUT_LABELS[command]}</Box>
              <Box component="dd" sx={{ m: 0, fontFamily: 'monospace', color: 'text.secondary' }}>
                {shortcutFor(command)}
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button autoFocus onClick={onClose}>
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
