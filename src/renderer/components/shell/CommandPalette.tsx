import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography } from '@mui/material';
import type { PaperProps } from '@mui/material';
import { File, Folder, Globe, FolderOpen, LayoutGrid, type LucideIcon } from 'lucide-react';
import { Box } from '@mui/material';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { NAV_AREAS, type Area } from './nav.js';
import { useAreaNavigation } from '../../hooks/use-area-navigation.js';
import { useContextNavigation } from '../../hooks/use-context-navigation.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';
import { focusOverview } from '../../lib/workspace-shell-store.js';
import { openManualTab } from '../../lib/browser-tabs-store.js';
import { callIpc } from '../../lib/ipc.js';
import { fileIconFor, toneColor } from '../../lib/file-icon.js';
import { fuzzyFilter } from '../../lib/fuzzy.js';
import { getRecentFiles } from '../../lib/recent-files-store.js';
import { openExternalFile, openFile } from '../../lib/file-opener.js';
import { activeEditorLineCount, goToLineInActiveEditor, hasActiveEditor } from '../../lib/editor-navigation.js';
import { useActiveWorkspace } from '../../hooks/use-workspaces.js';

/**
 * How the palette opens. `commands` is the classic palette (⌘K, the TopNav
 * button): commands with no prefix shown. `files` is ⌘P. `command-mode` is
 * ⇧⌘P (a `>` already typed) and `line` is ⌘G (a `:` already typed) — in the
 * last three, deleting the prefix falls back to the file list. `workspaces`
 * opens straight on "Ir para workspace…" (the TopNav switcher's "Todos…").
 */
export type PaletteIntent = 'commands' | 'files' | 'command-mode' | 'line' | 'workspaces';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  intent?: PaletteIntent;
}

const INITIAL_QUERY: Record<PaletteIntent, string> = { commands: '', files: '', 'command-mode': '>', line: ':', workspaces: '' };

type ActiveMode = 'commands' | 'files' | 'line';

/** The mode the raw input is in, and the text after any prefix. */
function parseQuery(raw: string, base: ActiveMode): { mode: ActiveMode; term: string } {
  if (raw.startsWith('>')) return { mode: 'commands', term: raw.slice(1) };
  if (raw.startsWith(':')) return { mode: 'line', term: raw.slice(1) };
  return { mode: base, term: raw };
}

const MAX_FILE_RESULTS = 50;

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

export function CommandPalette({ open, onClose, intent = 'commands' }: CommandPaletteProps): React.ReactElement {
  const baseMode: ActiveMode = intent === 'commands' || intent === 'workspaces' ? 'commands' : 'files';
  const [query, setQuery] = useState(INITIAL_QUERY[intent]);
  const [mode, setMode] = useState<PaletteMode>(intent === 'workspaces' ? 'workspaces' : 'root');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const navigate = useAreaNavigation();
  const { switchTo, openFolder } = useContextNavigation();
  const { data: workspaces } = useWorkspaces();
  const { data: activeWorkspace } = useActiveWorkspace();
  const parsed = parseQuery(query, baseMode);
  const filesActive = open && parsed.mode === 'files' && mode === 'root' && activeWorkspace != null;
  const { data: allFiles } = useQuery<string[]>({
    queryKey: ['workspace', 'listFiles', activeWorkspace?.id ?? null],
    queryFn: () => callIpc<string[]>('workspace.listFiles'),
    enabled: filesActive,
    staleTime: 10_000,
  });

  const commands = useMemo<Command[]>(() => {
    if (mode === 'workspaces') {
      return [...(workspaces ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((w) => ({ id: `workspace-${w.id}`, label: w.name, glyph: Folder, run: () => switchTo(w.id) }));
    }
    const go = (area: Area) => () => navigate(area);
    return [
      { id: 'overview', label: 'Visão geral', glyph: LayoutGrid, shortcut: '⌘0', run: focusOverview },
      { id: 'new-browser', label: 'Novo navegador', glyph: Globe, run: () => openManualTab() },
      { id: 'open-folder', label: 'Abrir pasta…', glyph: FolderOpen, shortcut: '⌘O', run: openFolder },
      {
        id: 'open-external-file',
        label: 'Abrir arquivo…',
        glyph: File,
        run: async () => {
          const picked = await callIpc<string[]>('externalFile.pick');
          if (picked.length > 0) openExternalFile(picked);
        },
      },
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

  const commandTerm = (mode === 'workspaces' ? query : parsed.term).trim().toLowerCase();
  const filtered = commands.filter((c) => c.label.toLowerCase().includes(commandTerm));

  const fileResults = useMemo(() => {
    if (!filesActive || allFiles === undefined) return [];
    if (parsed.term.trim() === '') {
      const known = new Set(allFiles);
      return getRecentFiles().filter((p) => known.has(p)).slice(0, 15).map((path) => ({ item: path, match: { score: 0, indices: [] as number[] } }));
    }
    return fuzzyFilter(parsed.term.trim(), allFiles, (p) => p, MAX_FILE_RESULTS);
  }, [filesActive, allFiles, parsed.term]);

  const handleClose = (): void => {
    setQuery(INITIAL_QUERY[intent]);
    setMode('root');
    onClose();
  };

  const lineNumber = /^\d+$/.test(parsed.term.trim()) ? Number(parsed.term.trim()) : null;
  const lineCount = parsed.mode === 'line' ? activeEditorLineCount() : null;
  const submitLine = (): void => {
    if (lineNumber === null || lineNumber < 1) return;
    if (goToLineInActiveEditor(lineNumber)) handleClose();
  };

  const submitFirst = (): void => {
    if (mode === 'workspaces' || parsed.mode === 'commands') {
      const first = filtered[0];
      if (first) select(first);
    } else if (parsed.mode === 'files') {
      const first = fileResults[0];
      if (first) openPaletteFile(first.item);
    } else {
      submitLine();
    }
  };

  const openPaletteFile = (relPath: string): void => {
    handleClose();
    openFile(relPath);
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
          placeholder={
            mode === 'workspaces'
              ? 'Ir para workspace…'
              : parsed.mode === 'files'
              ? 'Buscar arquivo por nome (> comandos, : linha)'
              : parsed.mode === 'line'
              ? 'Número da linha'
              : 'Buscar telas e ações…'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitFirst();
            }
          }}
          slotProps={{
            htmlInput: {
              'data-testid': 'command-palette-input',
              'aria-label': 'Buscar',
            },
          }}
          sx={{ p: 1.5 }}
        />
        <List dense sx={{ maxHeight: 360, overflowY: 'auto' }}>
          {mode === 'root' && parsed.mode === 'files' && activeWorkspace == null && (
            <Typography variant="body2" color="text.secondary" data-testid="palette-no-workspace" sx={{ px: 2, py: 1 }}>
              Abra uma pasta para buscar arquivos.
            </Typography>
          )}
          {mode === 'root' && parsed.mode === 'files' && activeWorkspace != null && fileResults.map(({ item, match }) => (
            <PaletteFileRow key={item} path={item} indices={match.indices} onSelect={() => openPaletteFile(item)} />
          ))}
          {mode === 'root' && parsed.mode === 'line' && (
            <ListItemButton data-testid="palette-go-to-line" disabled={lineNumber === null || !hasActiveEditor()} onClick={submitLine}>
              <ListItemText
                primary={
                  !hasActiveEditor()
                    ? 'Abra um arquivo para ir a uma linha'
                    : lineNumber === null
                    ? `Digite um número de linha${lineCount !== null ? ` (1 a ${lineCount})` : ''}`
                    : `Ir para a linha ${lineNumber}`
                }
              />
            </ListItemButton>
          )}
          {(mode === 'workspaces' || parsed.mode === 'commands') && filtered.map((c) => (
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

function PaletteFileRow({ path, indices, onSelect }: { path: string; indices: readonly number[]; onSelect: () => void }): React.ReactElement {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const dir = slash === -1 ? '' : path.slice(0, slash);
  const { glyph, tone } = fileIconFor(name);
  const hit = new Set(indices);
  const offset = slash + 1;
  return (
    <ListItemButton data-testid={`palette-file-${path}`} onClick={onSelect}>
      <ListItemIcon sx={{ minWidth: 30 }}>
        <Box component="span" sx={(theme) => ({ display: 'inline-flex', color: toneColor(theme, tone) ?? 'inherit' })}>
          <Icon glyph={glyph} size={16} />
        </Box>
      </ListItemIcon>
      <ListItemText
        primary={
          <>
            {[...name].map((ch, i) => (
              <Box key={i} component="span" sx={hit.has(offset + i) ? { fontWeight: 700, color: 'secondary.main' } : undefined}>{ch}</Box>
            ))}
          </>
        }
        secondary={dir === '' ? undefined : dir}
        slotProps={{ secondary: { noWrap: true } }}
      />
    </ListItemButton>
  );
}
