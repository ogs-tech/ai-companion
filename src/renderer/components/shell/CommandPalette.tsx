import { useMemo, useState } from 'react';
import { Dialog, List, ListItemButton, ListItemIcon, ListItemText, TextField } from '@mui/material';
import type { PaperProps } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { NAV_AREAS, type Area } from './nav.js';
import { useAreaNavigation } from '../../hooks/use-area-navigation.js';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Command {
  id: string;
  label: string;
  glyph: LucideIcon;
  run: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const navigate = useAreaNavigation();

  const commands = useMemo<Command[]>(() => {
    const go = (area: Area) => () => {
      navigate(area);
      onClose();
    };

    return NAV_AREAS.map((a) => ({
      id: `go-${a.area}`,
      label: a.label,
      glyph: a.glyph,
      run: go(a.area),
    }));
  }, [navigate, onClose]);

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm"
      slotProps={{ paper: { 'data-testid': 'command-palette', elevation: 8 } as PaperProps }}>
      <TextField
        autoFocus
        fullWidth
        placeholder="Buscar telas e ações…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        slotProps={{
          htmlInput: {
            'data-testid': 'command-palette-input',
            'aria-label': 'Buscar',
          },
        }}
        sx={{ p: 1.5 }}
      />
      <List dense sx={{ maxHeight: 360, overflowY: 'auto' }}>
        {filtered.map((c) => (
          <ListItemButton key={c.id} onClick={c.run}>
            <ListItemIcon sx={{ minWidth: 30 }}>
              <Icon glyph={c.glyph} size={16} />
            </ListItemIcon>
            <ListItemText primary={c.label} />
          </ListItemButton>
        ))}
      </List>
    </Dialog>
  );
}
