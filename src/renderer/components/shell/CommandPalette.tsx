import { useMemo, useState } from 'react';
import { Dialog, List, ListItemButton, ListItemIcon, ListItemText, TextField } from '@mui/material';
import type { PaperProps } from '@mui/material';
import { Search, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { areaHasSub, LIBRARY_SUBS, NAV_AREAS, PLUGINS_SUBS, type LibrarySub, type Nav } from './nav.js';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (nav: Nav) => void;
  onCreate: (sub: LibrarySub) => void;
}

interface Command {
  id: string;
  label: string;
  glyph: LucideIcon;
  run: () => void;
}

const CREATABLE: ReadonlyArray<{ sub: LibrarySub; label: string }> = [
  { sub: 'skills', label: 'Nova skill' },
  { sub: 'agents', label: 'Novo agent' },
  { sub: 'hooks', label: 'Novo hook' },
];

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onCreate,
}: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = useState('');

  const commands = useMemo<Command[]>(() => {
    const go = (nav: Nav) => () => {
      onNavigate(nav);
      onClose();
    };

    const jumps: Command[] = [
      ...NAV_AREAS.filter((a) => !areaHasSub(a.area)).map((a) => ({
        id: `go-${a.area}`,
        label: a.label,
        glyph: a.glyph,
        run: go({ area: a.area } as Nav),
      })),
      ...LIBRARY_SUBS.map((s) => ({
        id: `go-${s.sub}`,
        label: s.label,
        glyph: s.glyph,
        run: go({ area: 'biblioteca', sub: s.sub }),
      })),
      ...PLUGINS_SUBS.map((s) => ({
        id: `go-plugin-${s.sub}`,
        label: s.label,
        glyph: s.glyph,
        run: go({ area: 'plugins', sub: s.sub }),
      })),
    ];

    const creates: Command[] = CREATABLE.map((c) => {
      const def = LIBRARY_SUBS.find((s) => s.sub === c.sub);
      return {
        id: `new-${c.sub}`,
        label: c.label,
        glyph: def ? def.glyph : Search,
        run: () => {
          onCreate(c.sub);
          onClose();
        },
      };
    });

    return [...jumps, ...creates];
  }, [onNavigate, onCreate, onClose]);

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
