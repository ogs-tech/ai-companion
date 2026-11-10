import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ButtonBase, Dialog, List, ListItemButton, ListItemIcon, ListItemText, Stack, TextField, Typography } from '@mui/material';
import type { PaperProps } from '@mui/material';
import { Bot, File, Folder, Globe, FolderOpen, LayoutGrid, Sparkles, type LucideIcon } from 'lucide-react';
import { Box } from '@mui/material';
import { Icon } from '../ds/Icon.js';
import { StateGlyph } from '../SessionStateMark.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { NAV_AREAS, type Area } from './nav.js';
import { useAreaNavigation } from '../../hooks/use-area-navigation.js';
import { useContextNavigation } from '../../hooks/use-context-navigation.js';
import { useCustomizationList } from '../../hooks/use-customization-list.js';
import { useRunChannels } from '../../hooks/use-run-channels.js';
import { useSessions } from '../../hooks/use-sessions.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';
import { focusOverview } from '../../lib/workspace-shell-store.js';
import { openManualTab } from '../../lib/browser-tabs-store.js';
import { callIpc } from '../../lib/ipc.js';
import { fileIconFor, toneColor } from '../../lib/file-icon.js';
import { fuzzyFilter } from '../../lib/fuzzy.js';
import { getRecentFiles } from '../../lib/recent-files-store.js';
import { openExternalFile, openFile } from '../../lib/file-opener.js';
import { activeEditorLineCount, goToLineInActiveEditor, hasActiveEditor } from '../../lib/editor-navigation.js';
import { openEntityFromPalette, openSessionFromPalette, startSessionFromPalette } from '../../lib/palette-actions-store.js';
import { PREFIX_HINTS, parseSearchQuery, searchCustomizations, searchSessions, type SearchMode } from '../../lib/palette-search.js';
import { attentionLabel, FILTER_LABELS } from '../../lib/session-attention.js';
import { CHANNELS, type ChannelId } from '../../../shared/channel.js';
import type { Agent, Skill } from '../../../shared/entity.js';
import { useActiveWorkspace } from '../../hooks/use-workspaces.js';

/**
 * How the palette opens. `commands` is the unified search (⌘K, the TopNav
 * button): sessions, customizations, files and actions in grouped sections,
 * plus a "Perguntar à IA" row. `files` is ⌘P. `command-mode` is ⇧⌘P (a `>`
 * already typed) and `line` is ⌘G (a `:` already typed) — in the last three,
 * deleting the prefix falls back to the file list. `workspaces` opens straight
 * on "Ir para workspace…" (the TopNav switcher's "Todos…").
 */
export type PaletteIntent = 'commands' | 'files' | 'command-mode' | 'line' | 'workspaces';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  intent?: PaletteIntent;
}

const INITIAL_QUERY: Record<PaletteIntent, string> = { commands: '', files: '', 'command-mode': '>', line: ':', workspaces: '' };

const MAX_FILE_RESULTS = 50;
/** In the unified search, files are one section among several: keep it short. */
const MAX_FILE_RESULTS_UNIFIED = 5;

interface Command {
  id: string;
  label: string;
  glyph: LucideIcon;
  shortcut?: string;
  /** Keeps the palette open — for a command that opens a nested list. */
  keepOpen?: boolean;
  run: () => void | Promise<unknown>;
}

/** One selectable row, whatever section it belongs to — what ↑↓ and Enter walk over. */
interface PaletteItem {
  key: string;
  testId: string;
  group: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  secondary?: string | undefined;
  meta?: string | undefined;
  /** The "Perguntar à IA" row — set apart from the section above it. */
  ai?: boolean;
  keepOpen?: boolean;
  run: () => void | Promise<unknown>;
}

/** 'root' = the search; 'workspaces' = "Ir para workspace…"'s own list. */
type PaletteMode = 'root' | 'workspaces';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function CommandPalette({ open, onClose, intent = 'commands' }: CommandPaletteProps): React.ReactElement {
  const baseMode: SearchMode = intent === 'commands' || intent === 'workspaces' ? 'all' : 'files';
  const [query, setQueryState] = useState(INITIAL_QUERY[intent]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<PaletteMode>(intent === 'workspaces' ? 'workspaces' : 'root');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useAreaNavigation();
  const { switchTo, openFolder } = useContextNavigation();
  const { data: workspaces } = useWorkspaces();
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: sessions } = useSessions();
  const { data: skills } = useCustomizationList('skill', 'skill.list');
  const { data: agents } = useCustomizationList('agent', 'agent.list');
  const runChannels = useRunChannels();
  const parsed = parseSearchQuery(query, baseMode);
  const term = parsed.term.trim();

  // The channel "Perguntar à IA" starts: the first enabled one whose CLI is installed (Claude when settings are still loading).
  const aiChannel: ChannelId = runChannels.options.find((o) => o.available)?.id ?? 'claude';
  const aiName = CHANNELS[aiChannel].displayName;
  const contextName = activeWorkspace?.name ?? 'Início';

  const setQuery = (next: string): void => {
    setQueryState(next);
    setSelected(0);
  };

  const filesWanted = parsed.mode === 'files' || (parsed.mode === 'all' && term !== '');
  const filesActive = open && filesWanted && mode === 'root' && activeWorkspace != null;
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
          setQueryState('');
          setSelected(0);
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
  const filteredCommands = useMemo(() => commands.filter((c) => c.label.toLowerCase().includes(commandTerm)), [commands, commandTerm]);

  const fileResults = useMemo(() => {
    if (!filesActive || allFiles === undefined) return [];
    if (term === '') {
      if (parsed.mode !== 'files') return [];
      const known = new Set(allFiles);
      return getRecentFiles().filter((p) => known.has(p)).slice(0, 15).map((path) => ({ item: path, match: { score: 0, indices: [] as number[] } }));
    }
    return fuzzyFilter(term, allFiles, (p) => p, parsed.mode === 'files' ? MAX_FILE_RESULTS : MAX_FILE_RESULTS_UNIFIED);
  }, [filesActive, allFiles, term, parsed.mode]);

  const handleClose = (): void => {
    setQuery(INITIAL_QUERY[intent]);
    setMode('root');
    onClose();
  };

  const lineNumber = /^\d+$/.test(term) ? Number(term) : null;
  const lineCount = parsed.mode === 'line' ? activeEditorLineCount() : null;
  const submitLine = (): void => {
    if (lineNumber === null || lineNumber < 1) return;
    if (goToLineInActiveEditor(lineNumber)) handleClose();
  };

  const runItem = (item: PaletteItem): void => {
    if (!item.keepOpen) handleClose();
    Promise.resolve(item.run()).catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
  };

  const askAi = (): void => {
    startSessionFromPalette({ prompt: term, channel: aiChannel });
    handleClose();
  };

  const items = useMemo<PaletteItem[]>(() => {
    if (mode === 'workspaces') {
      return filteredCommands.map((c) => ({ key: c.id, testId: `command-${c.id}`, group: '', icon: <Icon glyph={c.glyph} size={16} />, label: c.label, run: c.run }));
    }
    if (parsed.mode === 'line') return [];

    const out: PaletteItem[] = [];
    const showAll = parsed.mode === 'all';

    if (showAll || parsed.mode === 'sessions') {
      for (const { session, state } of searchSessions(sessions ?? [], term, showAll ? 6 : 20)) {
        out.push({
          key: `session-${session.sessionId}`,
          testId: `palette-session-${session.sessionId}`,
          group: showAll && term === '' ? 'Em andamento' : 'Sessões',
          icon: <Box component="span" sx={{ display: 'inline-flex', color: state === 'needs-input' ? 'warning.main' : state === 'working' ? 'success.main' : 'text.secondary' }}><StateGlyph state={state} size={14} /></Box>,
          label: session.label,
          secondary: state === 'needs-input' ? attentionLabel(session.attention) : `${CHANNELS[session.harness].displayName} · ${FILTER_LABELS[state]}`,
          run: () => openSessionFromPalette({ sessionId: session.sessionId, anchor: session.anchor, label: session.label, scopeId: session.scopeId }),
        });
      }
    }

    if (showAll || parsed.mode === 'customizations') {
      const entities = [
        ...(skills ?? []).map((e) => ({ entity: e, kind: 'skill' as const })),
        ...(agents ?? []).map((e) => ({ entity: e, kind: 'agent' as const })),
      ];
      const hits = searchCustomizations(entities.map((x) => x.entity), term, showAll ? 5 : 20);
      for (const hit of hits) {
        const kind = entities.find((x) => x.entity.urn === hit.urn)?.kind ?? 'skill';
        out.push({
          key: `entity-${hit.urn}`,
          testId: `palette-entity-${hit.urn}`,
          group: 'Customizações',
          icon: <Icon glyph={kind === 'agent' ? Bot : Sparkles} size={16} />,
          label: hit.name,
          secondary: kind === 'agent' ? 'agent' : 'skill',
          run: () => openEntityFromPalette(kind, hit as Skill | Agent),
        });
      }
    }

    if ((showAll || parsed.mode === 'files') && activeWorkspace != null) {
      for (const { item: path, match } of fileResults) {
        out.push({
          key: `file-${path}`,
          testId: `palette-file-${path}`,
          group: 'Arquivos',
          icon: <FileGlyph name={path.slice(path.lastIndexOf('/') + 1)} />,
          label: <FileName path={path} indices={match.indices} />,
          secondary: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined,
          run: () => openFile(path),
        });
      }
    }

    if (showAll || parsed.mode === 'commands') {
      for (const c of filteredCommands) {
        out.push({ key: `command-${c.id}`, testId: `command-${c.id}`, group: 'Ações', icon: <Icon glyph={c.glyph} size={16} />, label: c.label, meta: c.shortcut, keepOpen: c.keepOpen === true, run: c.run });
      }
    }

    if (showAll && term !== '') {
      out.push({ key: 'ask-ai', testId: 'palette-ask-ai', group: '', ai: true, icon: <Icon glyph={Sparkles} size={16} />, label: `Perguntar ao ${aiName}: “${term}”`, meta: '⌘↵', run: () => startSessionFromPalette({ prompt: term, channel: aiChannel }) });
    }
    return out;
  }, [mode, parsed.mode, term, sessions, skills, agents, fileResults, filteredCommands, activeWorkspace, aiName, aiChannel]);

  const current = Math.min(selected, Math.max(items.length - 1, 0));
  const noWorkspaceForFiles = mode === 'root' && parsed.mode === 'files' && activeWorkspace == null;

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected((current + step + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && mode === 'root' && parsed.mode === 'all' && term !== '') {
        askAi();
      } else if (mode === 'root' && parsed.mode === 'line') {
        submitLine();
      } else {
        const item = items[current];
        if (item) runItem(item);
      }
    }
  };

  const showHints = mode === 'root' && parsed.mode === 'all' && query === '';

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm"
        slotProps={{ paper: { 'data-testid': 'command-palette', elevation: 8 } as PaperProps }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.5 }}>
          {mode === 'root' && (
            <Typography
              component="span"
              data-testid="palette-context-chip"
              variant="caption"
              noWrap
              sx={(theme) => ({ flex: 'none', maxWidth: 180, px: 1, py: 0.25, borderRadius: 99, border: `1px solid ${theme.palette.divider}`, color: 'text.secondary' })}
            >
              {contextName} · {CHANNELS[aiChannel].displayName}
            </Typography>
          )}
          <TextField
            autoFocus
            fullWidth
            placeholder={
              mode === 'workspaces'
                ? 'Ir para workspace…'
                : parsed.mode === 'files'
                ? 'Buscar arquivo por nome'
                : parsed.mode === 'line'
                ? 'Número da linha'
                : parsed.mode === 'sessions'
                ? 'Buscar sessão pelo nome'
                : parsed.mode === 'customizations'
                ? 'Buscar skill ou agent'
                : parsed.mode === 'commands'
                ? 'Buscar ações'
                : 'Buscar, ir para ou perguntar à IA…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            inputRef={inputRef}
            slotProps={{
              htmlInput: {
                'data-testid': 'command-palette-input',
                'aria-label': 'Buscar',
              },
            }}
          />
        </Stack>
        {showHints && (
          <Stack direction="row" spacing={0.75} data-testid="palette-prefix-hints" sx={{ px: 1.5, pb: 0.5 }}>
            {PREFIX_HINTS.map((h) => (
              <ButtonBase
                key={h.prefix}
                aria-label={`Filtrar por ${h.label}`}
                onClick={() => {
                  setQuery(h.prefix);
                  inputRef.current?.focus();
                }}
                sx={(theme) => ({ px: 0.75, py: 0.125, borderRadius: 1, border: `1px solid ${theme.palette.divider}`, fontSize: '0.6875rem', color: 'text.secondary' })}
              >
                <Box component="span" sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, mr: 0.5 })}>{h.prefix}</Box>
                {h.label}
              </ButtonBase>
            ))}
          </Stack>
        )}
        <List dense sx={{ maxHeight: 360, overflowY: 'auto' }}>
          {noWorkspaceForFiles && (
            <Typography variant="body2" color="text.secondary" data-testid="palette-no-workspace" sx={{ px: 2, py: 1 }}>
              Abra uma pasta para buscar arquivos.
            </Typography>
          )}
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
          {items.map((item, index) => {
            const header = item.group !== '' && item.group !== items[index - 1]?.group ? item.group : null;
            return (
              <Box key={item.key} sx={item.ai ? { mt: 0.5, pt: 0.5, borderTop: 1, borderColor: 'divider' } : undefined}>
                {header !== null && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1, pb: 0.25 }}>{header}</Typography>
                )}
                <ListItemButton
                  data-testid={item.testId}
                  selected={index === current}
                  onClick={() => runItem(item)}
                  onMouseMove={() => index !== current && setSelected(index)}
                  ref={(el: HTMLElement | null) => {
                    if (index === current) el?.scrollIntoView?.({ block: 'nearest' });
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30 }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} secondary={item.secondary} slotProps={{ secondary: { noWrap: true }, primary: { noWrap: true } }} />
                  {item.meta && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{item.meta}</Typography>}
                </ListItemButton>
              </Box>
            );
          })}
        </List>
      </Dialog>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

function FileGlyph({ name }: { name: string }): React.ReactElement {
  const { glyph, tone } = fileIconFor(name);
  return (
    <Box component="span" sx={(theme) => ({ display: 'inline-flex', color: toneColor(theme, tone) ?? 'inherit' })}>
      <Icon glyph={glyph} size={16} />
    </Box>
  );
}

/** The file's name with the fuzzy-matched characters emphasised. */
function FileName({ path, indices }: { path: string; indices: readonly number[] }): React.ReactElement {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const hit = new Set(indices);
  const offset = path.lastIndexOf('/') + 1;
  return (
    <>
      {[...name].map((ch, i) => (
        <Box key={i} component="span" sx={hit.has(offset + i) ? { fontWeight: 700, color: 'secondary.main' } : undefined}>{ch}</Box>
      ))}
    </>
  );
}
