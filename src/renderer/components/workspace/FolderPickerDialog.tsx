import { useState } from 'react';
import { Box, Dialog, DialogContent, DialogTitle, List, ListItemButton, ListItemText, TextField, Typography } from '@mui/material';
import { useWorkspaceFolders } from '../../hooks/use-terminals.js';

interface FolderPickerDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Receives the workspace-relative folder (`''` is the root). */
  onPick: (relPath: string) => void;
}

const MAX_VISIBLE = 50;

/** A searchable list of the workspace's folders: type to filter, Enter opens the first match (or the highlighted one). */
export function FolderPickerDialog({ open, title, onClose, onPick }: FolderPickerDialogProps): React.ReactElement {
  const { data: folders = [], isPending } = useWorkspaceFolders(open);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const needle = query.trim().toLowerCase();
  const matches = ['', ...folders].filter((f) => f.toLowerCase().includes(needle)).slice(0, MAX_VISIBLE);
  const active = Math.min(highlight, Math.max(matches.length - 1, 0));

  const pick = (relPath: string): void => {
    setQuery('');
    setHighlight(0);
    onPick(relPath);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" data-testid="folder-picker">
      <DialogTitle sx={{ fontSize: '0.95rem' }}>{title}</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="Filtrar pastas…"
          value={query}
          slotProps={{ htmlInput: { 'data-testid': 'folder-picker-input' } }}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight(Math.min(active + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight(Math.max(active - 1, 0));
            } else if (e.key === 'Enter' && matches[active] !== undefined) {
              e.preventDefault();
              pick(matches[active]);
            }
          }}
        />
        <List dense sx={{ maxHeight: 280, overflowY: 'auto', mt: 1 }}>
          {matches.map((relPath, index) => (
            <ListItemButton
              key={relPath}
              selected={index === active}
              data-testid={`folder-picker-option-${relPath === '' ? 'root' : relPath}`}
              onClick={() => pick(relPath)}
            >
              <ListItemText
                primary={relPath === '' ? 'raiz' : relPath}
                slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.8rem' } } }}
              />
            </ListItemButton>
          ))}
        </List>
        {!isPending && matches.length === 0 && (
          <Box sx={{ py: 1 }}>
            <Typography variant="caption" color="text.secondary">Nenhuma pasta encontrada</Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
