import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, InputAdornment, TextField, ToggleButton, Tooltip, Typography } from '@mui/material';
import { Search } from 'lucide-react';
import { SectionHeader } from '../ds/ContainerChrome.js';
import { Icon } from '../ds/Icon.js';
import { callIpc } from '../../lib/ipc.js';
import { fileIconFor } from '../../lib/file-icon.js';
import type { SearchMatch, SearchRequest, SearchResult } from '../../../shared/file-ops.js';
import { SEARCH_MATCH_CAP } from '../../../shared/file-ops.js';

const DEBOUNCE_MS = 250;

interface ProjectSearchPanelProps {
  /** Bumped by `⇧⌘F` to move focus (and select the text) in the query field. */
  focusSignal: number;
  onOpenMatch: (match: SearchMatch) => void;
}

interface Group {
  path: string;
  matches: SearchMatch[];
}

function groupByFile(matches: readonly SearchMatch[]): Group[] {
  const groups = new Map<string, SearchMatch[]>();
  for (const m of matches) groups.set(m.path, [...(groups.get(m.path) ?? []), m]);
  return [...groups].map(([path, list]) => ({ path, matches: list }));
}

/** The line with the matched range emphasised. */
function HitText({ match }: { match: SearchMatch }): React.ReactElement {
  const { text, start, end } = match;
  return (
    <>
      {text.slice(0, start)}
      <Box component="mark" sx={{ bgcolor: 'warning.main', color: 'common.black', borderRadius: 0.25, px: 0.125 }}>
        {text.slice(start, end)}
      </Box>
      {text.slice(end)}
    </>
  );
}

function newRequestId(): string {
  return `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * "Buscar" in the Explorer rail: a query field with case / whole-word / regex
 * toggles and the hits grouped by file. The search itself runs in the main
 * process (debounced here; a newer query cancels the older one there).
 */
export function ProjectSearchPanel({ focusSignal, onOpenMatch }: ProjectSearchPanelProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [rawResult, setResult] = useState<SearchResult | null>(null);
  const [rawError, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestRequest = useRef<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  useEffect(() => {
    if (query === '') return undefined;
    const requestId = newRequestId();
    const timer = setTimeout(() => {
      latestRequest.current = requestId;
      setSearching(true);
      const request: SearchRequest = { requestId, query, caseSensitive, wholeWord, regex };
      callIpc<SearchResult>('workspace.search', request).then(
        (next) => {
          if (latestRequest.current !== requestId || next.cancelled) return;
          setResult(next);
          setError(null);
          setSearching(false);
        },
        (err: unknown) => {
          if (latestRequest.current !== requestId) return;
          setResult(null);
          setError(err instanceof Error ? err.message : String(err));
          setSearching(false);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      // Leaving the field mid-flight (or typing again) cancels what was started.
      if (latestRequest.current !== null) void callIpc('workspace.cancelSearch', { requestId: latestRequest.current }).catch(() => undefined);
    };
  }, [query, caseSensitive, wholeWord, regex]);

  // An emptied field shows nothing, whatever the last search left behind.
  const result = query === '' ? null : rawResult;
  const error = query === '' ? null : rawError;
  const groups = useMemo(() => groupByFile(result?.matches ?? []), [result]);

  const toggle = (label: string, hint: string, value: boolean, set: (v: boolean) => void, testId: string): React.ReactElement => (
    <Tooltip title={hint}>
      <ToggleButton
        value={label}
        size="small"
        selected={value}
        onChange={() => set(!value)}
        aria-label={hint}
        data-testid={testId}
        sx={{ px: 0.75, py: 0, minWidth: 26, height: 22, fontSize: '0.7rem', fontFamily: 'monospace', border: 0 }}
      >
        {label}
      </ToggleButton>
    </Tooltip>
  );

  return (
    <Box data-testid="project-search" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SectionHeader level="view" title="Buscar no projeto" testId="project-search-header" />
      <Box sx={{ px: 1.25, pb: 0.75 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Buscar"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputRef={inputRef}
          error={error !== null}
          slotProps={{
            htmlInput: { 'data-testid': 'project-search-input', 'aria-label': 'Buscar no projeto' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Icon glyph={Search} size={14} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  {toggle('Aa', 'Diferenciar maiúsculas de minúsculas', caseSensitive, setCaseSensitive, 'project-search-case')}
                  {toggle('ab', 'Palavra inteira', wholeWord, setWholeWord, 'project-search-word')}
                  {toggle('.*', 'Expressão regular', regex, setRegex, 'project-search-regex')}
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pb: 1 }}>
        {error !== null && (
          <Typography variant="caption" color="error" role="alert" data-testid="project-search-error" sx={{ display: 'block', px: 1.5, py: 0.5 }}>
            {error}
          </Typography>
        )}
        {result !== null && (
          <Typography variant="caption" color="text.secondary" data-testid="project-search-summary" sx={{ display: 'block', px: 1.5, py: 0.5 }}>
            {result.matches.length === 0
              ? 'Nenhum resultado'
              : `${result.matches.length} ${result.matches.length === 1 ? 'resultado' : 'resultados'} em ${result.fileCount} ${result.fileCount === 1 ? 'arquivo' : 'arquivos'}`}
            {result.truncated && ` — mostrando os primeiros ${SEARCH_MATCH_CAP}`}
          </Typography>
        )}
        {searching && result === null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.5 }}>
            Buscando…
          </Typography>
        )}
        {groups.map((group) => {
          const name = group.path.slice(group.path.lastIndexOf('/') + 1);
          const dir = group.path.slice(0, Math.max(group.path.lastIndexOf('/'), 0));
          const { glyph, tone } = fileIconFor(name);
          return (
            <Box key={group.path} data-testid={`project-search-file-${group.path}`}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.25 }}>
                <Box component="span" sx={(theme) => ({ display: 'inline-flex', color: tone === 'azul' ? theme.palette.info.main : tone === 'ambar' ? theme.palette.warning.main : tone === 'verde' ? theme.palette.success.main : tone === 'slate' ? theme.ogs.slate : 'inherit' })}>
                  <Icon glyph={glyph} size={14} />
                </Box>
                <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 500 }}>{name}</Typography>
                {dir !== '' && <Typography noWrap sx={{ fontSize: '0.7rem', color: 'text.secondary', minWidth: 0 }}>{dir}</Typography>}
                <Typography component="span" sx={{ ml: 'auto', fontSize: '0.7rem', color: 'text.secondary' }}>{group.matches.length}</Typography>
              </Box>
              {group.matches.map((match) => (
                <Box
                  key={`${match.line}:${match.start}`}
                  role="button"
                  tabIndex={0}
                  data-testid={`project-search-hit-${group.path}:${match.line}`}
                  onClick={() => onOpenMatch(match)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onOpenMatch(match);
                  }}
                  sx={{ display: 'flex', gap: 1, pl: 4, pr: 1.5, py: 0.125, cursor: 'pointer', fontSize: '0.75rem', '&:hover, &:focus-visible': { bgcolor: 'action.hover' }, outline: 'none' }}
                >
                  <Typography component="span" sx={{ color: 'text.secondary', fontSize: '0.7rem', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {match.line}
                  </Typography>
                  <Typography noWrap component="span" sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.72rem', minWidth: 0 })}>
                    <HitText match={match} />
                  </Typography>
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
