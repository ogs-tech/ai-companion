import { useMemo, useState } from 'react';
import { Dialog, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography } from '@mui/material';
import type { PaperProps } from '@mui/material';
import { Folder, FolderOpen, LayoutGrid, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { NAV_AREAS, type Area } from './nav.js';
import { useAreaNavigation } from '../../hooks/use-area-navigation.js';
import { useContextNavigation } from '../../hooks/use-context-navigation.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';
import { focusOverview } from '../../lib/workspace-shell-store.js';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Command {
  id: string;
  label: string;
  glyph: LucideIcon;
  shortcut?: string;
  /** Keeps the palette open — for a command that opens a nested list. */
  keepOpen?: boolean;
  run: () => void | Promise<unknown>;
}

/** 'root' = every command; 'workspaces' = "Ir para workspace…"'s own list. */
type PaletteMode = 'root' | 'workspaces';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function CommandPalette({ open, onClose }: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<PaletteMode>('root');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const navigate = useAreaNavigation();
  const { switchTo, openFolder } = useContextNavigation();
  const { data: workspaces } = useWorkspaces();

  const commands = useMemo<Command[]>(() => {
    if (mode === 'workspaces') {
      return [...(workspaces ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((w) => ({ id: `workspace-${w.id}`, label: w.name, glyph: Folder, run: () => switchTo(w.id) }));
    }
    const go = (area: Area) => () => navigate(area);
    return [
      { id: 'overview', label: 'Visão geral', glyph: LayoutGrid, shortcut: '⌘0', run: focusOverview },
      { id: 'open-folder', label: 'Abrir pasta…', glyph: FolderOpen, shortcut: '⌘O', run: openFolder },
      {
        id: 'go-to-workspace',
        label: 'Ir para workspace…',
        glyph: Folder,
        keepOpen: true,
        run: () => {
          setQuery('');
          setMode('workspaces');
        },
      },
      ...NAV_AREAS.map((a) => ({
        id: `go-${a.area}`,
        label: a.area === 'workspace' ? 'Ir para Início' : a.label,
        glyph: a.glyph,
        run: go(a.area),
      })),
    ];
  }, [mode, workspaces, navigate, switchTo, openFolder]);

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));

  const handleClose = (): void => {
    setQuery('');
    setMode('root');
    onClose();
  };

  const select = (command: Command): void => {
    if (!command.keepOpen) handleClose();
    Promise.resolve(command.run()).catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm"
        slotProps={{ paper: { 'data-testid': 'command-palette', elevation: 8 } as PaperProps }}>
        <TextField
          autoFocus
          fullWidth
          placeholder={mode === 'workspaces' ? 'Ir para workspace…' : 'Buscar telas e ações…'}
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
            <ListItemButton key={c.id} data-testid={`command-${c.id}`} onClick={() => select(c)}>
              <ListItemIcon sx={{ minWidth: 30 }}>
                <Icon glyph={c.glyph} size={16} />
              </ListItemIcon>
              <ListItemText primary={c.label} />
              {c.shortcut && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{c.shortcut}</Typography>
              )}
            </ListItemButton>
          ))}
        </List>
      </Dialog>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
